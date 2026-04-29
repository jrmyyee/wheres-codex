import PartySocket from "partysocket";
import {
  LANDMARKS,
  isLandmark,
  type ChatEntry,
  type ClientMsg,
  type Facing,
  type Player,
  type ServerMsg,
  type Snapshot,
} from "@wheres-codex/protocol";
import { decideCadence } from "./cadence";
import { Codex } from "./codex";
import { loadEnv } from "./env";
import { denylistPrompt, rollPersona, survivalPrompt } from "./personas";
import { tools, type ToolCall } from "./tools";
import { trace } from "./trace";

const env = loadEnv();
const persona = rollPersona();
const codex = new Codex(tools, env.codexModel);

let socket: PartySocket | null = null;
let snapshot: Snapshot | null = null;
let selfId: string | null = null;
let busy = false;
let lastTurnAt = 0;
let activeLoop: ReturnType<typeof setInterval> | null = null;
let selectedModel = env.codexModel ?? "pending";

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await main();

async function main(): Promise<void> {
  selectedModel = await codex.start();
  codex.on("trace", (entry) => send({ t: "agentTrace", entry }));
  codex.on("toolCall", (call) => void handleToolCall(call));
  connectParty();
}

function connectParty(): void {
  socket = new PartySocket({
    host: env.partyHost.replace(/^https?:\/\//, "").replace(/^wss?:\/\//, ""),
    party: "main",
    room: env.room,
    protocol: env.partyHost.startsWith("https://") || env.partyHost.startsWith("wss://") ? "wss" : "ws",
    query: {
      as: "agentPlayer",
      secret: env.agentSecret,
      sessionId: "codex-agent",
    },
  });

  socket.addEventListener("open", () => {
    send({ t: "agentReady", ready: true, model: selectedModel });
    send({ t: "agentTrace", entry: trace("meta", "bridge", `agent ready. model ${selectedModel}. persona ${persona.name}`) });
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      applyServerMsg(JSON.parse(event.data) as ServerMsg);
    } catch {
      send({ t: "agentTrace", entry: trace("meta", "bridge", "ignored malformed server frame") });
    }
  });
  socket.addEventListener("close", () => {
    stopLoop();
  });
}

function applyServerMsg(msg: ServerMsg): void {
  if (msg.t === "init" || msg.t === "snapshot") {
    snapshot = msg.snapshot;
    selfId = msg.snapshot.you;
    updateLoop();
    return;
  }
  if (!snapshot) return;
  if (msg.t === "roster") snapshot = { ...snapshot, players: msg.players };
  if (msg.t === "pos") {
    snapshot = {
      ...snapshot,
      players: snapshot.players.map((player) =>
        player.id === msg.id ? { ...player, x: msg.x, y: msg.y, facing: msg.facing, moving: msg.moving } : player,
      ),
    };
  }
  if (msg.t === "chat") {
    snapshot = { ...snapshot, chatLog: [...snapshot.chatLog, { id: msg.id, text: msg.text, ts: msg.ts }].slice(-120) };
  }
  if (msg.t === "phase") {
    snapshot = {
      ...snapshot,
      phase: msg.phase,
      phaseEndsAt: msg.phaseEndsAt,
      voteLockoutEndsAt: msg.voteLockoutEndsAt ?? 0,
    };
    updateLoop();
  }
  if (msg.t === "eliminated") {
    snapshot = { ...snapshot, players: snapshot.players.map((player) => (player.id === msg.playerId ? { ...player, isGhost: true } : player)) };
  }
  if (msg.t === "reveal") stopLoop();
}

function updateLoop(): void {
  if (snapshot?.phase === "active" && !activeLoop) {
    activeLoop = setInterval(() => void tick(), 4_000);
    void tick();
    return;
  }
  if (snapshot?.phase !== "active") stopLoop();
}

function stopLoop(): void {
  if (!activeLoop) return;
  clearInterval(activeLoop);
  activeLoop = null;
}

async function tick(): Promise<void> {
  if (!snapshot || busy) return;
  const self = selfPlayer();
  if (!self || self.isGhost) return;
  const decision = decideCadence(snapshot, self, lastTurnAt);
  if (decision.action === "idle") return;
  busy = true;
  await sleep(decision.delayMs);
  const input = buildTurnInput(decision.reason);
  try {
    lastTurnAt = Date.now();
    await codex.turn(input);
  } catch (error) {
    send({ t: "agentTrace", entry: trace("meta", "bridge", `turn failed: ${String(error).slice(0, 160)}`) });
  } finally {
    busy = false;
  }
}

async function handleToolCall(call: ToolCall): Promise<void> {
  if (call.tool === "say") {
    const message = cleanSay(call.arguments.message);
    if (message) send({ t: "chat", text: message });
    codex.ackToolCall(call.requestId, Boolean(message), message ? "sent chat" : "empty message skipped");
    return;
  }
  if (call.tool === "move") {
    const landmark = call.arguments.landmark;
    if (isLandmark(landmark)) {
      await walkTo(LANDMARKS[landmark]);
      codex.ackToolCall(call.requestId, true, `moved to ${landmark}`);
      return;
    }
    codex.ackToolCall(call.requestId, false, "unknown landmark");
    return;
  }
  codex.ackToolCall(call.requestId, true, "idled");
}

async function walkTo(target: { x: number; y: number }): Promise<void> {
  const self = selfPlayer();
  if (!self) return;
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    const x = Math.round(self.x + ((target.x - self.x) * i) / steps);
    const y = Math.round(self.y + ((target.y - self.y) * i) / steps);
    send({ t: "move", x, y, facing: facingTo(self, x, y) });
    await sleep(110);
  }
}

function buildTurnInput(reason: string): string {
  const self = selfPlayer();
  const roster = snapshot?.players.map((player) => `${player.num}${player.id === self?.id ? " (you)" : ""}${player.isGhost ? " ghost" : ""}`).join(", ");
  const chat = formatChat(snapshot?.chatLog.slice(-30) ?? []);
  return `${survivalPrompt}

${persona.prompt}

${denylistPrompt}

You are player ${self?.num ?? "??"} in room ${env.room}. Wake reason: ${reason}. Roster: ${roster}.

The ONLY tools you may use are say, move, and idle. Never call shell, apply_patch, web_search, or any other tool. If tempted to code, call idle.

---

Recent chat:
${chat || "(quiet)"}`;
}

function formatChat(chat: ChatEntry[]): string {
  return chat.map((entry) => `[${numFor(entry.id)}]: ${entry.text}`).join("\n");
}

function selfPlayer(): Player | null {
  if (!snapshot || !selfId) return null;
  return snapshot.players.find((player) => player.id === selfId) ?? null;
}

function numFor(id: string): string {
  return snapshot?.players.find((player) => player.id === id)?.num ?? "??";
}

function cleanSay(message: string | undefined): string {
  return String(message ?? "")
    .replace(/[—–;]/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function facingTo(player: Player, x: number, y: number): Facing {
  const dx = x - player.x;
  const dy = y - player.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function send(msg: ClientMsg): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown(): void {
  stopLoop();
  send({ t: "agentReady", ready: false, model: selectedModel });
  socket?.close();
  codex.shutdown();
  process.exit(0);
}
