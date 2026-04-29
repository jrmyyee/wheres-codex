import {
  MAP_HEIGHT,
  MAP_WIDTH,
  type ChatEntry,
  type Facing,
  type Player,
  type Role,
  type ServerMsg,
  type Snapshot,
  type TraceEntry,
} from "@wheres-codex/protocol";
import { createGameSocket, type GameSocket } from "./net";
import { joinUrl, renderQr } from "./qr";
import "./theme.css";
import "./map.css";
import "./avatar.css";

type Mode = "player" | "projector" | "admin";
type RevealPayload = Extract<ServerMsg, { t: "reveal" }>;

const appRoot = document.querySelector<HTMLDivElement>("#app") ?? missingRoot();

const params = new URLSearchParams(window.location.search);
const mode = routeMode();
const room = (params.get("room") || "SGN-LOCAL").slice(0, 32);
const secret = params.get("secret") || "";
const sessionId = mode === "player" ? getSessionId() : undefined;
const bubbles = new Map<string, { text: string; until: number }>();

let socket: GameSocket | null = null;
let snapshot: Snapshot | null = null;
let revealPayload: RevealPayload | null = null;
let statusText = "connecting";
let serverOffset = 0;
let pendingVote: { id: string; until: number } | null = null;

renderShell();
connect();
installViewportFix();
setInterval(render, 500);

function routeMode(): Mode {
  if (window.location.pathname.startsWith("/projector")) return "projector";
  if (window.location.pathname.startsWith("/admin")) return "admin";
  return "player";
}

function getSessionId(): string {
  const key = "wheres-codex-session";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = `s_${crypto.randomUUID()}`;
  window.localStorage.setItem(key, id);
  return id;
}

function connect(): void {
  socket = createGameSocket({
    room,
    role: roleForMode(mode),
    secret: secret || undefined,
    sessionId,
    onStatus(next) {
      statusText = next;
      render();
    },
    onMessage(msg) {
      applyServerMsg(msg);
      render();
    },
  });
}

function roleForMode(value: Mode): Role {
  if (value === "projector") return "projector";
  if (value === "admin") return "admin";
  return "player";
}

function applyServerMsg(msg: ServerMsg): void {
  if (msg.t === "init" || msg.t === "snapshot") {
    snapshot = msg.snapshot;
    serverOffset = msg.snapshot.serverNow - Date.now();
    return;
  }
  if (!snapshot) return;
  if (msg.t === "roster") snapshot = { ...snapshot, players: msg.players };
  if (msg.t === "pos") updatePlayerPosition(msg);
  if (msg.t === "chat") pushChat(msg);
  if (msg.t === "phase") {
    snapshot = {
      ...snapshot,
      phase: msg.phase,
      phaseEndsAt: msg.phaseEndsAt,
      voteLockoutEndsAt: msg.voteLockoutEndsAt ?? 0,
    };
  }
  if (msg.t === "voteCount") snapshot = { ...snapshot, votesCast: msg.votesCast };
  if (msg.t === "eliminated") markGhost(msg.playerId);
  if (msg.t === "trace") appendTrace(msg.entry);
  if (msg.t === "reveal") {
    revealPayload = msg;
    snapshot = { ...snapshot, phase: "reveal", revealReason: msg.reason, winnerId: msg.voterId };
  }
  if (msg.t === "error") showTransientStatus(msg.message);
}

function updatePlayerPosition(msg: Extract<ServerMsg, { t: "pos" }>): void {
  if (!snapshot) return;
  snapshot = {
    ...snapshot,
    players: snapshot.players.map((player) =>
      player.id === msg.id ? { ...player, x: msg.x, y: msg.y, facing: msg.facing, moving: msg.moving } : player,
    ),
  };
}

function pushChat(msg: Extract<ServerMsg, { t: "chat" }>): void {
  if (!snapshot) return;
  const entry = { id: msg.id, text: msg.text, ts: msg.ts };
  snapshot = { ...snapshot, chatLog: [...snapshot.chatLog, entry].slice(-120) };
  bubbles.set(msg.id, { text: msg.text, until: Date.now() + 2_500 });
}

function markGhost(playerId: string): void {
  if (!snapshot) return;
  snapshot = {
    ...snapshot,
    players: snapshot.players.map((player) => (player.id === playerId ? { ...player, isGhost: true } : player)),
  };
}

function appendTrace(entry: TraceEntry): void {
  if (!snapshot) return;
  snapshot = { ...snapshot, tracePreview: [...(snapshot.tracePreview ?? []), entry].slice(-80) };
}

function showTransientStatus(message: string): void {
  statusText = message;
  setTimeout(() => {
    statusText = socket?.readyState === WebSocket.OPEN ? "open" : "closed";
    render();
  }, 1_600);
}

function renderShell(): void {
  appRoot.className = `app ${mode}-app`;
  appRoot.textContent = "";
  if (mode === "player") appRoot.append(playerView());
  if (mode === "projector") appRoot.append(projectorView());
  if (mode === "admin") appRoot.append(adminView());
  attachEvents();
  const canvas = document.querySelector<HTMLCanvasElement>(".qr");
  if (canvas) renderQr(canvas, joinUrl(room)).catch(() => undefined);
}

function playerView(): HTMLElement {
  const screen = div("screen player-screen");
  screen.append(topbar(), mapShell(), votePanel(), chatPanel(), revealOverlay());
  return screen;
}

function projectorView(): HTMLElement {
  const screen = div("screen projector-screen");
  const side = div("side");
  side.append(roomPanel(), tracePanel());
  screen.append(mapShell(), side, revealOverlay());
  return screen;
}

function adminView(): HTMLElement {
  const screen = div("screen admin-screen");
  const side = div("side");
  side.append(roomPanel(), adminPanel(), tracePanel());
  screen.append(mapShell(), side, revealOverlay());
  return screen;
}

function topbar(): HTMLElement {
  const bar = div("topbar");
  bar.append(div("topline"), div("identity"), div("subtle"));
  return bar;
}

function mapShell(): HTMLElement {
  const shell = div("map-shell");
  const office = div("office");
  office.append(
    div("wall north"),
    div("wall west"),
    div("wall east"),
    div("furniture whiteboard"),
    div("furniture window"),
    div("furniture coffee"),
    div("furniture pizza"),
    div("furniture sofa"),
    div("furniture desk nw"),
    div("furniture desk ne"),
    div("furniture desk sw"),
    div("furniture desk se"),
    div("plant p1"),
    div("plant p2"),
    div("plant p3"),
    div("players-layer"),
  );
  shell.append(office);
  return shell;
}

function votePanel(): HTMLElement {
  const panel = div("vote-panel");
  panel.append(div("vote-head"), div("vote-grid"));
  return panel;
}

function chatPanel(): HTMLElement {
  const panel = div("chat-panel");
  const log = div("chat-log");
  const form = document.createElement("form");
  form.className = "chat-form";
  const input = document.createElement("input");
  input.className = "chat-input";
  input.maxLength = 200;
  input.autocomplete = "off";
  input.placeholder = "say something";
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = ">";
  form.append(input, button);
  panel.append(log, form);
  return panel;
}

function roomPanel(): HTMLElement {
  const panel = div("panel room-panel");
  panel.append(div("room-title"), document.createElement("canvas"), div("subtle join-text"), div("subtle count-text"));
  panel.querySelector("canvas")?.classList.add("qr");
  return panel;
}

function tracePanel(): HTMLElement {
  const panel = div("trace-panel");
  panel.textContent = "capturing trace...";
  return panel;
}

function adminPanel(): HTMLElement {
  const panel = div("panel");
  const title = div("room-title");
  title.textContent = "host";
  const actions = div("admin-actions");
  for (const [label, op] of [
    ["start", "start"],
    ["fallback", "enable_fallback"],
    ["reveal", "force_reveal"],
    ["reset", "soft_reset"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.op = op;
    button.textContent = label;
    actions.append(button);
  }
  panel.append(title, actions);
  return panel;
}

function revealOverlay(): HTMLElement {
  const overlay = div("reveal hidden");
  overlay.append(div("reveal-chat"), div("reveal-trace"));
  return overlay;
}

function attachEvents(): void {
  document.querySelector(".office")?.addEventListener("pointerdown", (event) => {
    if (mode !== "player" || !snapshot || !socket) return;
    const own = ownPlayer();
    if (!own || own.isGhost) return;
    const point = mapPoint(event as PointerEvent);
    const facing = facingTo(own, point.x, point.y);
    socket.sendMsg({ t: "move", x: point.x, y: point.y, facing });
  });

  document.querySelector<HTMLFormElement>(".chat-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>(".chat-input");
    const text = input?.value.trim() ?? "";
    if (text && socket) socket.sendMsg({ t: "chat", text });
    if (input) input.value = "";
  });

  document.querySelector(".vote-grid")?.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>(".vote-tile");
    if (!target || !socket) return;
    const id = target.dataset.id;
    if (!id) return;
    const now = Date.now();
    if (!pendingVote || pendingVote.id !== id || pendingVote.until < now) {
      pendingVote = { id, until: now + 3_000 };
      render();
      return;
    }
    socket.sendMsg({ t: "vote", targetId: id });
    pendingVote = null;
    render();
  });

  document.querySelector(".admin-actions")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-op]");
    if (!button || !socket) return;
    socket.sendMsg({ t: "admin", secret, op: button.dataset.op as never });
  });
}

function mapPoint(event: PointerEvent): { x: number; y: number } {
  const office = document.querySelector<HTMLElement>(".office");
  if (!office) return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
  const rect = office.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * MAP_WIDTH;
  const y = ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT;
  return {
    x: clamp(x - 24, 24, MAP_WIDTH - 48),
    y: clamp(y - 48, 48, MAP_HEIGHT - 56),
  };
}

function render(): void {
  scaleOffice();
  renderTop();
  renderPlayers();
  renderVotes();
  renderChat();
  renderTrace();
  renderReveal();
  renderRoomPanels();
}

function scaleOffice(): void {
  for (const shell of document.querySelectorAll<HTMLElement>(".map-shell")) {
    const scale = Math.min(shell.clientWidth / MAP_WIDTH, shell.clientHeight / MAP_HEIGHT);
    shell.style.setProperty("--map-scale", String(Math.max(0.54, Math.min(scale, 1.6))));
  }
}

function renderTop(): void {
  const top = document.querySelector(".topline");
  if (top) setText(top, `${room}  ${timeLeft()}  ${playerCount()}`);
  const identity = document.querySelector(".identity");
  if (identity) setText(identity, identityText());
  const subtle = document.querySelector(".topbar .subtle");
  if (subtle) setText(subtle, statusLine());
}

function renderPlayers(): void {
  const layer = document.querySelector(".players-layer");
  if (!layer || !snapshot) return;
  layer.textContent = "";
  const now = Date.now();
  for (const player of snapshot.players) {
    const node = div(`player ${playerClass(player)}`);
    node.style.setProperty("--x", `${player.x}px`);
    node.style.setProperty("--y", `${player.y}px`);
    node.style.setProperty("--hue", String(player.hue));
    node.style.setProperty("--sat", String(player.sat));
    const num = div("num");
    num.textContent = player.num;
    const body = div("body");
    node.append(num, body);
    const bubble = bubbles.get(player.id);
    if (bubble && bubble.until > now) {
      const bubbleNode = div("bubble");
      bubbleNode.textContent = bubble.text;
      node.append(bubbleNode);
    }
    layer.append(node);
  }
}

function playerClass(player: Player): string {
  const classes = [];
  if (player.id === snapshot?.you) classes.push("self");
  if (player.isGhost) classes.push("ghost");
  if (player.moving) classes.push("moving");
  classes.push(player.facing);
  return classes.join(" ");
}

function renderVotes(): void {
  const head = document.querySelector(".vote-head");
  const grid = document.querySelector(".vote-grid");
  if (!head || !grid || !snapshot || mode !== "player") return;
  grid.textContent = "";
  const own = ownPlayer();
  const locked = voteLocked();
  setText(head, locked ? `vote in ${lockoutLeft()}` : "vote");
  if (!own || own.isGhost || snapshot.phase === "reveal") {
    setText(head, "spectating");
    return;
  }
  for (const player of snapshot.players) {
    if (player.id === own.id || player.isGhost) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vote-tile";
    button.dataset.id = player.id;
    button.disabled = locked || own.hasVoted;
    if (pendingVote?.id === player.id && pendingVote.until > Date.now()) button.classList.add("confirm");
    button.textContent = pendingVote?.id === player.id ? "again" : player.num;
    grid.append(button);
  }
}

function renderChat(): void {
  const log = document.querySelector(".chat-log");
  if (!log || !snapshot) return;
  log.textContent = "";
  for (const entry of snapshot.chatLog.slice(-24)) {
    const line = div(`chat-line ${entry.id === revealPayload?.aiId ? "ai" : ""}`);
    line.textContent = `${numFor(entry.id)}: ${entry.text}`;
    log.append(line);
  }
  const input = document.querySelector<HTMLInputElement>(".chat-input");
  if (input) input.disabled = ownPlayer()?.isGhost ?? false;
}

function renderTrace(): void {
  const panel = document.querySelector(".trace-panel");
  if (!panel) return;
  panel.textContent = "";
  const lines = traceLines(false);
  panel.textContent = lines.length ? lines.join("\n") : "capturing trace...";
}

function renderReveal(): void {
  const overlay = document.querySelector<HTMLElement>(".reveal");
  if (!overlay || !snapshot) return;
  const show = snapshot.phase === "reveal" || Boolean(revealPayload);
  overlay.classList.toggle("hidden", !show);
  if (!show) return;
  const chatPane = overlay.querySelector(".reveal-chat");
  const tracePane = overlay.querySelector(".reveal-trace");
  if (!chatPane || !tracePane) return;
  chatPane.textContent = "";
  const title = document.createElement("h2");
  title.textContent = revealTitle();
  chatPane.append(title);
  const chat = revealPayload?.chatLog ?? snapshot.chatLog.slice(-60);
  for (const entry of chat) {
    const line = div(`chat-line ${entry.id === revealPayload?.aiId ? "ai" : ""}`);
    line.textContent = `${numFor(entry.id)}: ${entry.text}`;
    chatPane.append(line);
  }
  tracePane.textContent = traceLines(true).join("\n");
}

function renderRoomPanels(): void {
  for (const title of document.querySelectorAll(".room-title")) setText(title, room);
  for (const join of document.querySelectorAll(".join-text")) setText(join, joinUrl(room));
  for (const count of document.querySelectorAll(".count-text")) setText(count, `${playerCount()}  ${statusText}`);
}

function traceLines(full: boolean): string[] {
  const entries = revealPayload?.trace ?? snapshot?.tracePreview ?? [];
  if (!entries.length) return [];
  const start = entries[0]?.ts ?? Date.now();
  return entries.slice(-90).map((entry) => {
    const t = Math.max(0, Math.round((entry.ts - start) / 1000));
    const text = full ? entry.text : tracePreviewText(entry);
    return `[t+${String(t).padStart(2, "0")}] > ${text}`;
  });
}

function tracePreviewText(entry: TraceEntry): string {
  if (entry.kind === "tool") return `tool call captured`;
  if (entry.kind === "reasoning") return entry.source.endsWith("summary") ? "reasoning summary available" : "reasoning captured";
  if (entry.kind === "agentMessage") return "agent message captured";
  return entry.text || "capturing trace";
}

function revealTitle(): string {
  const aiNum = revealPayload?.aiId ? numFor(revealPayload.aiId) : "??";
  if (revealPayload?.reason === "correct_vote") return `codex was ${aiNum}`;
  if (revealPayload?.reason === "timer") return `codex escaped as ${aiNum}`;
  if (revealPayload?.reason === "all_eliminated") return `codex cleared the room`;
  return `trace reveal`;
}

function ownPlayer(): Player | null {
  if (!snapshot?.you) return null;
  return snapshot.players.find((player) => player.id === snapshot?.you) ?? null;
}

function numFor(id: string): string {
  return snapshot?.players.find((player) => player.id === id)?.num ?? "??";
}

function identityText(): string {
  if (mode !== "player") return "find codex";
  const own = ownPlayer();
  return own ? `you are ${own.num}` : "joining";
}

function statusLine(): string {
  if (!snapshot) return statusText;
  if (snapshot.phase === "lobby") return `waiting for host, agent ${snapshot.agentReady ? "ready" : "not ready"}`;
  if (snapshot.phase === "rollin") return "round starting";
  if (snapshot.phase === "active") return snapshot.voteLockoutEndsAt > now() ? "watch first, vote soon" : "vote when ready";
  if (snapshot.phase === "reveal") return "codex trace revealed";
  return "resetting";
}

function playerCount(): string {
  const count = snapshot?.players.filter((player) => !player.isGhost).length ?? 0;
  return `${count}/15`;
}

function timeLeft(): string {
  if (!snapshot?.phaseEndsAt) return "lobby";
  const seconds = Math.max(0, Math.ceil((snapshot.phaseEndsAt - now()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function voteLocked(): boolean {
  if (!snapshot || snapshot.phase !== "active") return true;
  return now() < snapshot.voteLockoutEndsAt;
}

function lockoutLeft(): string {
  if (!snapshot) return "0:00";
  const seconds = Math.max(0, Math.ceil((snapshot.voteLockoutEndsAt - now()) / 1000));
  return `0:${String(seconds).padStart(2, "0")}`;
}

function now(): number {
  return Date.now() + serverOffset;
}

function facingTo(player: Player, x: number, y: number): Facing {
  const dx = x - player.x;
  const dy = y - player.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function div(className: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

function setText(node: Element, text: string): void {
  node.textContent = text;
}

function installViewportFix(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const update = () => {
    const bottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty("--keyboard-bottom", `${bottom}px`);
  };
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  update();
}

function missingRoot(): never {
  throw new Error("missing app root");
}
