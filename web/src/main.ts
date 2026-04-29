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
import { audio } from "./audio";
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
let lastFrame = 0;
let prevPhase: Snapshot["phase"] | null = null;
let countdownTimers: number[] = [];
let revealTriggered = false;
let audioUnlocked = false;
let muteState = audio.isMuted();

renderShell();
connect();
installViewportFix();
requestAnimationFrame(renderFrame);

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
    handlePhaseChange(snapshot.phase, snapshot.phaseEndsAt);
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
    handlePhaseChange(msg.phase, msg.phaseEndsAt);
  }
  if (msg.t === "voteCount") snapshot = { ...snapshot, votesCast: msg.votesCast };
  if (msg.t === "eliminated") markGhost(msg.playerId);
  if (msg.t === "trace") appendTrace(msg.entry);
  if (msg.t === "reveal") {
    revealPayload = msg;
    snapshot = { ...snapshot, phase: "reveal", revealReason: msg.reason, winnerId: msg.voterId };
    handleReveal(msg);
  }
  if (msg.t === "error") showTransientStatus(msg.message);
}

function handlePhaseChange(phase: Snapshot["phase"], phaseEndsAt: number): void {
  if (prevPhase === phase) return;
  for (const tid of countdownTimers) clearTimeout(tid);
  countdownTimers = [];
  if (phase !== "reveal" && phase !== "outro") revealTriggered = false;
  if (phase === "lobby") {
    if (audio.isReady()) audio.startLobbyMusic();
  } else if (phase === "rollin") {
    audio.stopLobbyMusic(400);
    scheduleCountdown(phaseEndsAt);
  } else if (phase === "active") {
    audio.stopLobbyMusic(150);
  } else if (phase === "reveal") {
    audio.stopLobbyMusic(200);
    if (!revealTriggered) {
      revealTriggered = true;
      audio.reveal();
    }
  } else if (phase === "outro") {
    if (audio.isReady()) audio.startLobbyMusic();
  }
  prevPhase = phase;
}

function scheduleCountdown(phaseEndsAt: number): void {
  const remaining = phaseEndsAt - now();
  if (remaining <= 0) return;
  for (const num of [3, 2, 1, 0]) {
    const fireAt = remaining - num * 1000;
    if (fireAt < 0) continue;
    const tid = window.setTimeout(() => audio.countdown(num), fireAt);
    countdownTimers.push(tid);
  }
}

function handleReveal(msg: RevealPayload): void {
  audio.stopLobbyMusic(200);
  if (!revealTriggered) {
    revealTriggered = true;
    audio.reveal();
  }
  if (msg.reason === "correct_vote") {
    window.setTimeout(() => audio.win(), 1100);
  }
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
  if (mode === "player" && msg.id !== snapshot.you) audio.chatPing();
}

function markGhost(playerId: string): void {
  if (!snapshot) return;
  const wasOwnAlive = playerId === snapshot.you && !snapshot.players.find((p) => p.id === playerId)?.isGhost;
  snapshot = {
    ...snapshot,
    players: snapshot.players.map((player) => (player.id === playerId ? { ...player, isGhost: true } : player)),
  };
  if (wasOwnAlive) audio.ghost();
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
  screen.append(topbar(), ruleStrip(), mapShell(), votePanel(), chatPanel(), revealOverlay());
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
  bar.append(div("topline"), div("identity-row"), div("subtle"));
  return bar;
}

function ruleStrip(): HTMLElement {
  const strip = div("rule-strip");
  for (const text of ["find codex", "wrong vote ghosts you", "correct vote reveals trace", "chat may project"]) {
    const item = div("rule-pill");
    item.textContent = text;
    strip.append(item);
  }
  return strip;
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
  panel.append(div("vote-head"), div("vote-grid"), div("vote-foot"));
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
  panel.append(div("room-kicker"), div("room-title"), document.createElement("canvas"), div("join-text"), div("subtle count-text"));
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
  const title = div("panel-title");
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
  installAudioUnlock();
  installMuteToggle();

  document.querySelector(".office")?.addEventListener("pointerdown", (event) => {
    if (mode !== "player" || !snapshot || !socket) return;
    if ((event.target as HTMLElement).closest(".player")) return;
    const own = ownPlayer();
    if (!own || own.isGhost) return;
    const point = mapPoint(event as PointerEvent);
    const facing = facingTo(own, point.x, point.y);
    socket.sendMsg({ t: "move", x: point.x, y: point.y, facing });
    audio.step();
  });

  document.querySelector<HTMLFormElement>(".chat-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>(".chat-input");
    const text = input?.value.trim() ?? "";
    if (text && socket) {
      socket.sendMsg({ t: "chat", text });
      audio.chatSend();
    }
    if (input) input.value = "";
  });

  document.querySelector(".vote-grid")?.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>(".vote-tile");
    if (!target || !socket) return;
    const own = ownPlayer();
    if (!own || own.isGhost || own.hasVoted || voteLocked()) return;
    const id = target.dataset.id;
    if (!id) return;
    socket.sendMsg({ t: "vote", targetId: id });
    audio.voteCast();
    render();
  });

  document.querySelector(".admin-actions")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-op]");
    if (!button || !socket) return;
    socket.sendMsg({ t: "admin", secret, op: button.dataset.op as never });
  });
}

function installAudioUnlock(): void {
  if (audioUnlocked) return;
  const unlock = () => {
    if (audioUnlocked) return;
    if (audio.init()) {
      audioUnlocked = true;
      if (snapshot && (snapshot.phase === "lobby" || snapshot.phase === "outro")) {
        audio.startLobbyMusic();
      }
    }
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
    document.removeEventListener("touchstart", unlock);
  };
  document.addEventListener("pointerdown", unlock, { passive: true });
  document.addEventListener("keydown", unlock);
  document.addEventListener("touchstart", unlock, { passive: true });
}

function installMuteToggle(): void {
  if (document.querySelector(".audio-toggle")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "audio-toggle";
  button.setAttribute("aria-label", muteState ? "unmute audio" : "mute audio");
  button.dataset.muted = muteState ? "1" : "0";
  button.textContent = muteState ? "muted" : "sound";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (!audio.isReady()) audio.init();
    muteState = audio.toggleMute();
    button.dataset.muted = muteState ? "1" : "0";
    button.textContent = muteState ? "muted" : "sound";
    button.setAttribute("aria-label", muteState ? "unmute audio" : "mute audio");
    if (!muteState && snapshot && (snapshot.phase === "lobby" || snapshot.phase === "outro")) {
      audio.startLobbyMusic();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "m" || event.key === "M") {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      button.click();
    }
  });
  document.body.appendChild(button);
}

function mapPoint(event: PointerEvent): { x: number; y: number } {
  const office = document.querySelector<HTMLElement>(".office");
  if (!office) return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
  const rect = office.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * MAP_WIDTH;
  const y = ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT;
  return {
    x: clamp(snap(x - 24, 24), 24, MAP_WIDTH - 48),
    y: clamp(snap(y - 48, 24), 48, MAP_HEIGHT - 56),
  };
}

function renderFrame(time: number): void {
  if (time - lastFrame >= 250) {
    renderTop();
    renderVotes();
    renderReveal();
    lastFrame = time;
  }
  requestAnimationFrame(renderFrame);
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
  if (top) renderTopline(top);
  const identity = document.querySelector(".identity-row");
  if (identity) renderIdentity(identity);
  const subtle = document.querySelector(".topbar .subtle");
  if (subtle) setText(subtle, statusLine());
}

function renderTopline(top: Element): void {
  top.textContent = "";
  top.append(statusBadge(room), statusBadge(phaseLabel()), statusBadge(timeLeft()), statusBadge(playerCount()));
}

function renderIdentity(identity: Element): void {
  identity.textContent = "";
  const own = ownPlayer();
  const label = div("identity");
  label.textContent = identityText();
  identity.append(label);
  if (mode === "player" && own) {
    const state = div(`state-chip ${own.isGhost ? "danger" : ""}`);
    state.textContent = own.isGhost ? "ghost" : own.hasVoted ? "vote locked" : "live";
    identity.append(state);
  }
}

function renderPlayers(): void {
  const layer = document.querySelector(".players-layer");
  if (!layer || !snapshot) return;
  layer.textContent = "";
  const now = Date.now();
  pruneBubbles(now);
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
  const panel = document.querySelector<HTMLElement>(".vote-panel");
  const head = document.querySelector(".vote-head");
  const grid = document.querySelector(".vote-grid");
  const foot = document.querySelector(".vote-foot");
  if (!panel || !head || !grid || !foot || mode !== "player") return;
  grid.textContent = "";
  foot.textContent = "";
  panel.removeAttribute("data-lockout");
  if (!snapshot) {
    setText(head, "vote grid");
    setText(foot, "connecting");
    return;
  }
  const own = ownPlayer();
  const locked = voteLocked();
  const targets = voteTargets(own);
  setText(head, voteHeadline(own, locked));
  setText(foot, voteFootline(own, targets.length, locked));
  panel.classList.toggle("vote-disabled", locked || !own || own.isGhost || own.hasVoted || snapshot.phase !== "active");
  if (locked && snapshot.phase === "active") panel.dataset.lockout = `vote in ${lockoutLeft()}`;
  if (!own || own.isGhost || snapshot.phase === "reveal" || snapshot.phase === "outro") {
    return;
  }
  for (const player of targets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vote-tile";
    button.dataset.id = player.id;
    button.disabled = locked || own.hasVoted || snapshot.phase !== "active";
    button.style.setProperty("--hue", String(player.hue));
    button.style.setProperty("--sat", String(player.sat));
    button.setAttribute("aria-label", `vote for ${player.num}`);
    button.append(voteMini(), voteNum(player.num), voteCaption("vote"));
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
  const button = document.querySelector<HTMLButtonElement>(".chat-form button");
  const ghost = ownPlayer()?.isGhost ?? false;
  if (input) {
    input.disabled = ghost;
    input.placeholder = ghost ? "ghosts cannot chat" : "say something";
  }
  if (button) button.disabled = ghost;
}

function renderTrace(): void {
  const panel = document.querySelector(".trace-panel");
  if (!panel) return;
  const lines = traceLines(false);
  const header = [`live trace`, `phase: ${snapshot?.phase ?? "connecting"}  votes: ${snapshot?.votesCast ?? 0}`];
  panel.textContent = [...header, "", ...(lines.length ? lines : ["capturing trace..."])].join("\n");
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
  const meta = div("reveal-meta");
  meta.textContent = revealMeta();
  chatPane.append(meta);
  const chat = revealPayload?.chatLog ?? snapshot.chatLog.slice(-60);
  for (const entry of chat) {
    const line = div(`chat-line ${entry.id === revealPayload?.aiId ? "ai" : ""}`);
    line.textContent = `${numFor(entry.id)}: ${entry.text}`;
    chatPane.append(line);
  }
  const lines = traceLines(true);
  tracePane.textContent = lines.length ? [...lines, finalTraceLine()].join("\n") : "trace buffer empty\n" + finalTraceLine();
}

function renderRoomPanels(): void {
  for (const kicker of document.querySelectorAll(".room-kicker")) setText(kicker, "scan to join");
  for (const title of document.querySelectorAll(".room-title")) setText(title, room);
  for (const join of document.querySelectorAll(".join-text")) setText(join, joinUrl(room));
  for (const count of document.querySelectorAll(".count-text")) {
    setText(count, `${playerCount()} joined  ${statusText}  agent ${snapshot?.agentReady ? "ready" : "waiting"}`);
  }
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
  if (entry.kind === "tool") return `tool call: ${toolPreview(entry.text)}`;
  if (entry.kind === "reasoning") return entry.source.endsWith("summary") ? "reasoning summary available" : "reasoning captured";
  if (entry.kind === "agentMessage") return "agent message captured";
  return entry.text || "capturing trace";
}

function toolPreview(text: string): string {
  const name = text.trim().split(/[\s({:]/)[0] || "captured";
  return name.slice(0, 24);
}

function revealTitle(): string {
  const aiNum = revealPayload?.aiId ? numFor(revealPayload.aiId) : "??";
  if (revealPayload?.reason === "correct_vote") return `codex was ${aiNum}`;
  if (revealPayload?.reason === "timer") return `codex escaped as ${aiNum}`;
  if (revealPayload?.reason === "all_eliminated") return `codex cleared the room`;
  return `trace reveal`;
}

function revealMeta(): string {
  const aiNum = revealPayload?.aiId ? numFor(revealPayload.aiId) : "??";
  if (revealPayload?.reason === "correct_vote") return `${numFor(revealPayload.voterId ?? "")} found ${aiNum}`;
  if (revealPayload?.reason === "host") return `host forced the reveal; codex was ${aiNum}`;
  const humans = snapshot?.players.filter((player) => !player.isGhost && player.id !== revealPayload?.aiId).length ?? 0;
  return `${humans} humans remained`;
}

function finalTraceLine(): string {
  const aiNum = revealPayload?.aiId ? numFor(revealPayload.aiId) : "??";
  if (revealPayload?.reason === "correct_vote") return `> round complete. codex detected as ${aiNum}.`;
  return `> round complete. codex was ${aiNum}.`;
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

function phaseLabel(): string {
  if (!snapshot) return "connecting";
  if (snapshot.phase === "rollin") return "starting";
  if (snapshot.phase === "active") return "active";
  if (snapshot.phase === "reveal") return "reveal";
  if (snapshot.phase === "outro") return "resetting";
  return "lobby";
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

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function voteTargets(own: Player | null): Player[] {
  if (!snapshot || !own) return [];
  return snapshot.players.filter((player) => player.id !== own.id && !player.isGhost);
}

function voteHeadline(own: Player | null, locked: boolean): string {
  if (!own) return "vote grid";
  if (own.isGhost) return "ghosted";
  if (snapshot?.phase === "lobby") return "vote opens after start";
  if (snapshot?.phase === "rollin") return "watch the room";
  if (snapshot?.phase === "reveal") return "trace reveal";
  if (own.hasVoted) return "vote locked";
  return locked ? `vote in ${lockoutLeft()}` : "vote";
}

function voteFootline(own: Player | null, targetCount: number, locked: boolean): string {
  if (!own) return "waiting for your number";
  if (own.isGhost) return "wrong voters become ghosts";
  if (own.hasVoted) return "your guess is locked";
  if (!targetCount) return "no live targets";
  if (snapshot?.phase !== "active") return "find codex, then vote when active";
  return locked ? "watch first, no votes yet" : "tap a number to vote";
}

function voteMini(): HTMLSpanElement {
  const mini = document.createElement("span");
  mini.className = "vote-mini";
  return mini;
}

function voteNum(num: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = "vote-num";
  node.textContent = num;
  return node;
}

function voteCaption(text: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = "vote-caption";
  node.textContent = text;
  return node;
}

function statusBadge(text: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = "status-badge";
  node.textContent = text;
  return node;
}

function pruneBubbles(nowMs: number): void {
  for (const [id, bubble] of bubbles) {
    if (bubble.until <= nowMs) bubbles.delete(id);
  }
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
