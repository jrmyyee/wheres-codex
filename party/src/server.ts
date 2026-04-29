import type * as Party from "partykit/server";
import {
  ACTIVE_DEMO_MS,
  ACTIVE_MS,
  CHAT_BURST_LIMIT,
  CHAT_BURST_WINDOW_MS,
  CHAT_LIMIT,
  CHAT_MAX_LENGTH,
  CHAT_MIN_INTERVAL_MS,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_HUMANS_LOBBY,
  MAX_PLAYERS_TOTAL,
  MOVE_MIN_INTERVAL_MS,
  OUTRO_MS,
  RECONNECT_GRACE_MS,
  REVEAL_MS,
  ROLLIN_MS,
  TRACE_LIMIT,
  TRACE_MAX_LENGTH,
  TRACE_RATE_LIMIT_PER_SEC,
  VOTE_LOCKOUT_DEMO_MS,
  VOTE_LOCKOUT_MS,
  type AdminOp,
  type ChatEntry,
  type ClientMsg,
  type ErrorCode,
  type Facing,
  type Phase,
  type Player,
  type RevealReason,
  type Role,
  type ServerMsg,
  type Snapshot,
  type TraceEntry,
  type TraceEntryInput,
  type TraceKind,
  type TraceSource,
} from "@wheres-codex/protocol";

type Env = {
  AGENT_SECRET?: string;
  PROJECTOR_SECRET?: string;
  ADMIN_SECRET?: string;
  MIN_PLAYERS?: string;
  DEMO_MODE?: string;
};

type ConnState = {
  role: Role;
  playerId?: string;
  sessionId?: string;
  localDev: boolean;
};

type InternalPlayer = Player & {
  sessionId: string;
  isAi: boolean;
  lastSeen: number;
  chatTimes: number[];
  lastChatAt: number;
  lastMoveAt: number;
  muted: boolean;
  voteTarget: string | null;
};

const SPAWN_POINTS = [
  { x: 96, y: 96 },
  { x: 192, y: 96 },
  { x: 336, y: 96 },
  { x: 480, y: 96 },
  { x: 120, y: 240 },
  { x: 240, y: 240 },
  { x: 360, y: 240 },
  { x: 504, y: 240 },
  { x: 120, y: 384 },
  { x: 240, y: 384 },
  { x: 360, y: 384 },
  { x: 504, y: 384 },
  { x: 300, y: 456 },
  { x: 432, y: 432 },
  { x: 72, y: 432 },
];

const BAD_WORDS = ["faggot", "nigger", "retard", "kys"];
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const ENV_PATTERN = /(sk-[a-zA-Z0-9_-]{16,}|[A-Z0-9_]{12,}=[^\s]+)/g;
const URL_SECRET_PATTERN = /(https?:\/\/[^\s?]+)\?[^\s]+/g;
const LOCAL_DEV_SECRETS = {
  AGENT_SECRET: "agent-dev-secret",
  PROJECTOR_SECRET: "projector-dev-secret",
  ADMIN_SECRET: "admin-dev-secret",
} as const satisfies Record<keyof Pick<Env, "AGENT_SECRET" | "PROJECTOR_SECRET" | "ADMIN_SECRET">, string>;

export default class Lobby implements Party.Server {
  readonly options = { hibernate: false };

  private players = new Map<string, InternalPlayer>();
  private sessionToPlayer = new Map<string, string>();
  private chatLog: ChatEntry[] = [];
  private traceBuffer: TraceEntry[] = [];
  private traceSeq = 0;
  private traceWindowStart = 0;
  private traceWindowCount = 0;
  private traceThrottleNotedAt = 0;
  private phase: Phase = "lobby";
  private phaseEndsAt = 0;
  private voteLockoutEndsAt = 0;
  private roundId = this.makeRoundId();
  private aiSlotId: string | null = null;
  private agentReady = false;
  private agentModel: string | undefined;
  private fallbackAgentEnabled = false;
  private winnerId: string | null = null;
  private revealReason: RevealReason | null = null;
  private revealVoterId: string | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly room: Party.Room) {}

  onRequest(request: Party.Request): Response {
    const url = new URL(request.url);
    const body = {
      ok: true,
      room: this.room.id,
      phase: this.phase,
      players: this.publicPlayers().length,
      agentReady: this.agentReady,
      fallbackAgentEnabled: this.fallbackAgentEnabled,
    };
    if (url.pathname.endsWith("/health")) {
      return Response.json(body);
    }
    return new Response(`wheres-codex ${this.room.id} ${this.phase} players=${body.players}`, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  onConnect(conn: Party.Connection<ConnState>, ctx: Party.ConnectionContext): void {
    const url = new URL(ctx.request.url);
    const role = this.parseRole(url.searchParams.get("as"));
    const sessionId = this.cleanSession(url.searchParams.get("sessionId"));
    const localDev = this.isLocalDevUrl(url);

    if (!this.authorize(role, url.searchParams.get("secret"), localDev)) {
      conn.setState({ role: "player", localDev });
      this.close(conn, 1008, "bad secret");
      return;
    }

    if (role === "projector" || role === "admin") {
      conn.setState({ role, localDev });
      this.send(conn, { t: "init", snapshot: this.snapshotFor(null, role) });
      return;
    }

    const player = this.assignPlayer(role, sessionId);
    if (!player) {
      conn.setState({ role, localDev });
      this.send(conn, { t: "error", code: "room_full", message: "room full" });
      this.close(conn, 1008, "room full");
      return;
    }

    player.connected = true;
    player.lastSeen = Date.now();
    conn.setState({ role, playerId: player.id, sessionId: player.sessionId, localDev });
    this.send(conn, { t: "init", snapshot: this.snapshotFor(player.id, role) });
    this.broadcastRoster();
  }

  onMessage(message: string | ArrayBuffer | ArrayBufferView, conn: Party.Connection<ConnState>): void {
    if (typeof message !== "string") return;
    const parsed = this.parseMessage(message);
    if (!parsed) {
      this.sendError(conn, "phase_mismatch", "bad message");
      return;
    }

    const state = conn.state;
    const role = state?.role ?? "player";
    const player = state?.playerId ? this.players.get(state.playerId) : undefined;

    switch (parsed.t) {
      case "hello":
        this.send(conn, { t: "snapshot", snapshot: this.snapshotFor(player?.id ?? null, role) });
        return;
      case "move":
        this.handleMove(conn, player, parsed);
        return;
      case "chat":
        this.handleChat(conn, player, parsed.text);
        return;
      case "vote":
        this.handleVote(conn, player, parsed.targetId);
        return;
      case "startRound":
        this.handleStart(conn, role);
        return;
      case "admin":
        this.handleAdmin(conn, role, parsed.secret, parsed.op);
        return;
      case "agentReady":
        this.handleAgentReady(conn, role, player, parsed.ready, parsed.model);
        return;
      case "agentTrace":
        this.handleAgentTrace(conn, role, player, parsed.entry);
        return;
    }
  }

  onClose(conn: Party.Connection<ConnState>): void {
    const playerId = conn.state?.playerId;
    if (!playerId) return;
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.lastSeen = Date.now();
    if (player.isAi) {
      this.agentReady = false;
      this.agentModel = undefined;
    }
    this.scheduleReconnectCleanup(player.id, player.sessionId);
    this.broadcastRoster();
    this.broadcastSnapshot();
  }

  private handleMove(conn: Party.Connection<ConnState>, player: InternalPlayer | undefined, msg: { x: number; y: number; facing: Facing }): void {
    if (!player || player.isGhost) return;
    if (this.phase === "reveal" || this.phase === "outro") {
      this.sendError(conn, "phase_mismatch", "movement locked");
      return;
    }
    const now = Date.now();
    if (now - player.lastMoveAt < MOVE_MIN_INTERVAL_MS) return;
    const x = Number(msg.x);
    const y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.isFacing(msg.facing)) return;
    player.lastMoveAt = now;
    player.x = this.clamp(x, 24, MAP_WIDTH - 48);
    player.y = this.clamp(y, 48, MAP_HEIGHT - 56);
    player.facing = msg.facing;
    player.moving = true;
    this.broadcastMsg({ t: "pos", id: player.id, x: player.x, y: player.y, facing: player.facing, moving: true });
    setTimeout(() => {
      const current = this.players.get(player.id);
      if (!current) return;
      current.moving = false;
      this.broadcastMsg({ t: "pos", id: current.id, x: current.x, y: current.y, facing: current.facing, moving: false });
    }, 220);
  }

  private handleChat(conn: Party.Connection<ConnState>, player: InternalPlayer | undefined, rawText: string): void {
    if (!player || player.isGhost || player.muted) return;
    if (this.phase === "reveal" || this.phase === "outro") {
      this.sendError(conn, "phase_mismatch", "chat locked");
      return;
    }
    if (typeof rawText !== "string") return;
    const now = Date.now();
    if (now - player.lastChatAt < CHAT_MIN_INTERVAL_MS) {
      this.sendError(conn, "rate_limited", "slow down");
      return;
    }
    player.chatTimes = player.chatTimes.filter((ts) => now - ts < CHAT_BURST_WINDOW_MS);
    if (player.chatTimes.length >= CHAT_BURST_LIMIT) {
      this.sendError(conn, "rate_limited", "chat rate limited");
      return;
    }
    const text = this.sanitizeChat(rawText);
    if (!text) return;
    player.lastChatAt = now;
    player.chatTimes.push(now);
    const entry = { id: player.id, text, ts: now };
    this.pushBounded(this.chatLog, entry, CHAT_LIMIT);
    this.broadcastMsg({ t: "chat", ...entry });
  }

  private handleVote(conn: Party.Connection<ConnState>, player: InternalPlayer | undefined, targetId: string): void {
    if (!player) return;
    if (player.isGhost) {
      this.sendError(conn, "vote_locked", "ghosts cannot vote");
      return;
    }
    if (typeof targetId !== "string") {
      this.sendError(conn, "invalid_target", "invalid vote target");
      return;
    }
    const now = Date.now();
    if (this.phase !== "active" || now < this.voteLockoutEndsAt || player.hasVoted) {
      this.sendError(conn, "vote_locked", "vote locked");
      return;
    }

    const target = this.players.get(String(targetId));
    if (!target || target.isGhost || target.id === player.id) {
      this.sendError(conn, "invalid_target", "invalid vote target");
      return;
    }

    player.hasVoted = true;
    player.voteTarget = target.id;
    if (target.id === this.aiSlotId) {
      this.startReveal("correct_vote", player.id, player.id);
      return;
    }

    player.isGhost = true;
    player.moving = false;
    this.broadcastMsg({ t: "eliminated", playerId: player.id });
    this.broadcastRoster();
    this.broadcastVoteCount();
    this.appendTrace({
      kind: "meta",
      source: "bridge",
      text: `${player.num} voted ${target.num}. wrong. one less detector in the room.`,
    });

    if (this.livingHumans().length === 0) {
      this.startReveal("all_eliminated", null, null);
    }
  }

  private handleStart(conn: Party.Connection<ConnState>, role: Role): void {
    if (role !== "admin" && role !== "projector") {
      this.sendError(conn, "not_host", "host only");
      return;
    }
    this.tryStartRound(conn);
  }

  private handleAdmin(conn: Party.Connection<ConnState>, role: Role, secret: string, op: string): void {
    if (role !== "admin" && !this.authorize("admin", secret, conn.state?.localDev === true)) {
      this.sendError(conn, "bad_secret", "bad admin secret");
      return;
    }

    if (!this.isAdminOp(op)) {
      this.sendError(conn, "phase_mismatch", "unknown admin op");
      return;
    }

    switch (op) {
      case "start":
        this.tryStartRound(conn);
        return;
      case "force_reveal":
        this.forceReveal(conn);
        return;
      case "enable_fallback":
        this.fallbackAgentEnabled = true;
        this.broadcastSnapshot();
        return;
      case "soft_reset":
        this.resetToLobby(false);
        return;
      case "hard_reset":
        this.resetToLobby(true);
        return;
    }
  }

  private handleAgentReady(
    conn: Party.Connection<ConnState>,
    role: Role,
    player: InternalPlayer | undefined,
    ready: boolean,
    model?: string,
  ): void {
    if (role !== "agentPlayer" || !player?.isAi) {
      this.sendError(conn, "bad_secret", "agent only");
      return;
    }
    this.aiSlotId = player.id;
    this.agentReady = Boolean(ready);
    this.agentModel = model ? String(model).slice(0, 80) : undefined;
    this.broadcastSnapshot();
  }

  private handleAgentTrace(conn: Party.Connection<ConnState>, role: Role, player: InternalPlayer | undefined, entry: TraceEntryInput): void {
    if (role !== "agentPlayer" || !player?.isAi) {
      this.sendError(conn, "bad_secret", "agent only");
      return;
    }
    if (!this.isTraceEntryInput(entry)) {
      this.sendError(conn, "phase_mismatch", "bad trace entry");
      return;
    }
    if (!this.allowTraceNow()) return;
    const trace = this.appendTrace(entry);
    this.sendTrace(trace);
  }

  private tryStartRound(conn: Party.Connection<ConnState>): void {
    if (this.phase !== "lobby") {
      this.sendError(conn, "phase_mismatch", "round already running");
      return;
    }
    if (!this.agentReady && !this.fallbackAgentEnabled) {
      this.sendError(conn, "agent_not_ready", "agent not ready");
      return;
    }
    if (this.humanPlayers().length < this.minPlayers()) {
      this.sendError(conn, "phase_mismatch", `need ${this.minPlayers()} humans`);
      return;
    }
    if (!this.aiSlotId && this.fallbackAgentEnabled) {
      this.createFallbackAi();
    }
    if (!this.aiSlotId) {
      this.sendError(conn, "agent_not_ready", "agent player missing");
      return;
    }
    this.startRollin();
  }

  private forceReveal(conn: Party.Connection<ConnState>): void {
    if (this.phase === "lobby" || this.phase === "outro" || !this.aiSlotId) {
      this.sendError(conn, "phase_mismatch", "no active round to reveal");
      return;
    }
    this.startReveal("host", null, null);
  }

  private startRollin(): void {
    this.roundId = this.makeRoundId();
    this.winnerId = null;
    this.revealReason = null;
    this.revealVoterId = null;
    this.traceBuffer = [];
    this.traceSeq = 0;
    this.respawnLivingPlayers();
    for (const player of this.players.values()) {
      player.isGhost = false;
      player.hasVoted = false;
      player.voteTarget = null;
      player.chatTimes = [];
      player.muted = false;
    }
    this.setPhase("rollin", Date.now() + ROLLIN_MS, 0);
    this.setTimer(() => this.startActive(), ROLLIN_MS);
  }

  private startActive(): void {
    const now = Date.now();
    const demoMode = this.demoMode();
    const activeMs = demoMode ? ACTIVE_DEMO_MS : ACTIVE_MS;
    const lockoutMs = demoMode ? VOTE_LOCKOUT_DEMO_MS : VOTE_LOCKOUT_MS;
    this.setPhase("active", now + activeMs, now + lockoutMs);
    this.appendTrace({ kind: "meta", source: "bridge", text: "round active. capturing trace." });
    this.setTimer(() => this.startReveal("timer", null, null), activeMs);
  }

  private startReveal(reason: RevealReason, voterId: string | null, winnerId: string | null): void {
    if (this.phase === "reveal" || this.phase === "outro") return;
    const aiId = this.aiSlotId;
    if (!aiId) return;
    this.winnerId = winnerId;
    this.revealReason = reason;
    this.revealVoterId = voterId;
    this.appendTrace({ kind: "meta", source: "bridge", text: this.finalTraceLine(reason) });
    this.setPhase("reveal", Date.now() + REVEAL_MS, 0);
    const reveal: ServerMsg = {
      t: "reveal",
      aiId,
      voterId,
      reason,
      chatLog: this.recentActiveChat(),
      trace: [...this.traceBuffer],
    };
    this.broadcastReveal(reveal);
    this.setTimer(() => this.startOutro(), REVEAL_MS);
  }

  private startOutro(): void {
    this.setPhase("outro", Date.now() + OUTRO_MS, 0);
    this.setTimer(() => this.resetToLobby(false), OUTRO_MS);
  }

  private resetToLobby(clearPlayers: boolean): void {
    this.clearTimer();
    if (clearPlayers) this.closePlayerConnections("hard reset");
    this.phase = "lobby";
    this.phaseEndsAt = 0;
    this.voteLockoutEndsAt = 0;
    this.roundId = this.makeRoundId();
    this.winnerId = null;
    this.revealReason = null;
    this.revealVoterId = null;
    this.traceBuffer = [];
    this.traceSeq = 0;
    this.chatLog = clearPlayers ? [] : this.chatLog.slice(-30);
    if (clearPlayers) {
      this.players.clear();
      this.sessionToPlayer.clear();
      this.aiSlotId = null;
      this.agentReady = false;
      this.agentModel = undefined;
    } else {
      for (const player of this.players.values()) {
        player.isGhost = false;
        player.hasVoted = false;
        player.voteTarget = null;
        player.muted = false;
      }
    }
    this.broadcastSnapshot();
    this.broadcastRoster();
  }

  private setPhase(phase: Phase, phaseEndsAt: number, voteLockoutEndsAt: number): void {
    this.phase = phase;
    this.phaseEndsAt = phaseEndsAt;
    this.voteLockoutEndsAt = voteLockoutEndsAt;
    this.broadcastMsg({ t: "phase", phase, phaseEndsAt, voteLockoutEndsAt });
  }

  private assignPlayer(role: Role, requestedSessionId: string | null): InternalPlayer | null {
    const sessionId = requestedSessionId ?? `${role}-${crypto.randomUUID()}`;
    const existingId = this.sessionToPlayer.get(sessionId);
    if (existingId) {
      const existing = this.players.get(existingId);
      if (existing) return this.roleOwnsPlayer(role, existing) ? existing : null;
      this.sessionToPlayer.delete(sessionId);
    }

    if (role === "agentPlayer" && this.aiSlotId) {
      const existingAi = this.players.get(this.aiSlotId);
      if (existingAi) {
        this.rebindSession(existingAi, sessionId);
        return existingAi;
      }
      this.aiSlotId = null;
    }

    if (role === "player" && this.humanPlayers().length >= MAX_HUMANS_LOBBY) return null;
    if (this.players.size >= MAX_PLAYERS_TOTAL) return null;

    const num = this.nextNum();
    if (!num) return null;
    const id = `p_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const spawn = SPAWN_POINTS[(Number(num) - 1) % SPAWN_POINTS.length];
    const player: InternalPlayer = {
      id,
      sessionId,
      num,
      spriteIndex: (Number(num) - 1) % 6,
      hue: (Number(num) * 47) % 360,
      sat: 0.9 + (Number(num) % 5) * 0.14,
      x: spawn.x,
      y: spawn.y,
      facing: "down",
      moving: false,
      isGhost: false,
      hasVoted: false,
      connected: true,
      isAi: role === "agentPlayer",
      lastSeen: Date.now(),
      chatTimes: [],
      lastChatAt: 0,
      lastMoveAt: 0,
      muted: false,
      voteTarget: null,
    };
    this.players.set(id, player);
    this.sessionToPlayer.set(sessionId, id);
    if (player.isAi) this.aiSlotId = id;
    return player;
  }

  private roleOwnsPlayer(role: Role, player: InternalPlayer): boolean {
    return role === "agentPlayer" ? player.isAi : !player.isAi;
  }

  private rebindSession(player: InternalPlayer, sessionId: string): void {
    if (player.sessionId === sessionId) return;
    this.sessionToPlayer.delete(player.sessionId);
    player.sessionId = sessionId;
    this.sessionToPlayer.set(sessionId, player.id);
  }

  private createFallbackAi(): void {
    if (this.aiSlotId) return;
    const player = this.assignPlayer("agentPlayer", "fallback-agent");
    if (!player) return;
    player.connected = true;
    this.aiSlotId = player.id;
    this.agentReady = true;
    this.agentModel = "fallback-script";
    this.appendTrace({ kind: "meta", source: "bridge", text: "fallback agent enabled" });
  }

  private respawnLivingPlayers(): void {
    let index = 0;
    for (const player of this.players.values()) {
      const spawn = SPAWN_POINTS[index % SPAWN_POINTS.length];
      player.x = spawn.x;
      player.y = spawn.y;
      player.facing = "down";
      player.moving = false;
      index += 1;
      this.broadcastMsg({ t: "pos", id: player.id, x: player.x, y: player.y, facing: player.facing, moving: false });
    }
  }

  private snapshotFor(playerId: string | null, role: Role): Snapshot {
    const privileged = role === "projector" || role === "admin";
    return {
      you: playerId,
      roundId: this.roundId,
      roomCode: this.room.id,
      serverNow: Date.now(),
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      voteLockoutEndsAt: this.voteLockoutEndsAt,
      players: this.publicPlayers(),
      chatLog: [...this.chatLog],
      tracePreview: privileged ? [...this.traceBuffer.slice(-40)] : undefined,
      agentReady: this.agentReady,
      agentModel: this.agentModel,
      fallbackAgentEnabled: this.fallbackAgentEnabled,
      winnerId: this.winnerId,
      revealReason: this.revealReason,
      votesCast: this.votesCast(),
      minPlayers: this.minPlayers(),
      demoMode: this.demoMode(),
    };
  }

  private broadcastSnapshot(): void {
    for (const conn of this.room.getConnections<ConnState>()) {
      const role = conn.state?.role ?? "player";
      const playerId = conn.state?.playerId ?? null;
      this.send(conn, { t: "snapshot", snapshot: this.snapshotFor(playerId, role) });
    }
  }

  private broadcastRoster(): void {
    this.broadcastMsg({ t: "roster", players: this.publicPlayers() });
  }

  private broadcastVoteCount(): void {
    this.broadcastMsg({ t: "voteCount", tally: {}, votesCast: this.votesCast() });
  }

  private broadcastReveal(reveal: Extract<ServerMsg, { t: "reveal" }>): void {
    const payload = JSON.stringify(reveal);
    for (const conn of this.room.getConnections<ConnState>()) {
      this.sendRaw(conn, payload);
    }
  }

  private sendTrace(entry: TraceEntry): void {
    const msg = JSON.stringify({ t: "trace", entry } satisfies ServerMsg);
    for (const conn of this.room.getConnections<ConnState>()) {
      const role = conn.state?.role;
      if (role === "projector" || role === "admin") this.sendRaw(conn, msg);
    }
  }

  private appendTrace(input: TraceEntryInput): TraceEntry {
    const entry = {
      kind: input.kind,
      source: input.source,
      text: this.sanitizeTrace(input.text),
      ts: Date.now(),
      seq: ++this.traceSeq,
    };
    this.pushBounded(this.traceBuffer, entry, TRACE_LIMIT);
    return entry;
  }

  private allowTraceNow(): boolean {
    const now = Date.now();
    if (now - this.traceWindowStart >= 1_000) {
      this.traceWindowStart = now;
      this.traceWindowCount = 0;
    }
    this.traceWindowCount += 1;
    if (this.traceWindowCount <= TRACE_RATE_LIMIT_PER_SEC) return true;
    if (now - this.traceThrottleNotedAt > 5_000) {
      this.traceThrottleNotedAt = now;
      const entry = this.appendTrace({ kind: "meta", source: "bridge", text: "trace throttled" });
      this.sendTrace(entry);
    }
    return false;
  }

  private publicPlayers(): Player[] {
    return [...this.players.values()]
      .sort((a, b) => a.num.localeCompare(b.num))
      .map(({ isAi, sessionId, lastSeen, chatTimes, lastChatAt, lastMoveAt, muted, voteTarget, ...player }) => player);
  }

  private humanPlayers(): InternalPlayer[] {
    return [...this.players.values()].filter((player) => !player.isAi);
  }

  private livingHumans(): InternalPlayer[] {
    return this.humanPlayers().filter((player) => !player.isGhost);
  }

  private votesCast(): number {
    return [...this.players.values()].filter((player) => player.hasVoted).length;
  }

  private recentActiveChat(): ChatEntry[] {
    const cutoff = Date.now() - 60_000;
    return this.chatLog.filter((entry) => entry.ts >= cutoff).slice(-60);
  }

  private finalTraceLine(reason: RevealReason): string {
    const humansLeft = this.livingHumans().length;
    if (reason === "correct_vote") return `round complete. codex detected. ${humansLeft} humans remained.`;
    if (reason === "timer") return `${humansLeft} humans remained. nobody voted correctly. codex walks away.`;
    if (reason === "all_eliminated") return "all human detectors eliminated. codex walks away.";
    return "host forced reveal. trace flushed.";
  }

  private nextNum(): string | null {
    const used = new Set([...this.players.values()].map((player) => player.num));
    for (let i = 1; i <= MAX_PLAYERS_TOTAL; i += 1) {
      const num = String(i).padStart(2, "0");
      if (!used.has(num)) return num;
    }
    return null;
  }

  private scheduleReconnectCleanup(playerId: string, sessionId: string): void {
    setTimeout(() => {
      const player = this.players.get(playerId);
      if (!player || player.connected) return;
      if (Date.now() - player.lastSeen < RECONNECT_GRACE_MS) return;
      if (this.phase !== "lobby" && !player.isGhost) return;
      this.players.delete(playerId);
      this.sessionToPlayer.delete(sessionId);
      if (this.aiSlotId === playerId) {
        this.aiSlotId = null;
        this.agentReady = false;
      }
      this.broadcastRoster();
      this.broadcastSnapshot();
    }, RECONNECT_GRACE_MS + 500);
  }

  private parseMessage(message: string): ClientMsg | null {
    try {
      const parsed = JSON.parse(message) as ClientMsg;
      if (parsed && typeof parsed === "object" && "t" in parsed) return parsed;
    } catch {
      return null;
    }
    return null;
  }

  private parseRole(value: string | null): Role {
    if (value === "agentPlayer" || value === "projector" || value === "admin") return value;
    return "player";
  }

  private authorize(role: Role, secret: string | null, localDev: boolean): boolean {
    if (role === "player") return true;
    const expected = this.expectedSecret(role, localDev);
    return Boolean(expected) && Boolean(secret) && secret === expected;
  }

  private expectedSecret(role: Role, localDev: boolean): string | null {
    if (role === "player") return null;
    const key = role === "agentPlayer" ? "AGENT_SECRET" : role === "projector" ? "PROJECTOR_SECRET" : "ADMIN_SECRET";
    const configured = this.cleanSecret(this.roomEnv()[key]);
    if (configured) return configured;
    return localDev ? LOCAL_DEV_SECRETS[key] : null;
  }

  private cleanSecret(value: string | undefined): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private cleanSession(value: string | null): string | null {
    if (!value) return null;
    return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || null;
  }

  private isLocalDevUrl(url: URL): boolean {
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "0.0.0.0" || url.hostname === "::1";
  }

  private sanitizeChat(rawText: string): string {
    const normalized = String(rawText ?? "").replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LENGTH);
    if (!normalized) return "";
    const lowered = normalized.toLowerCase();
    if (BAD_WORDS.some((word) => lowered.includes(word))) return "";
    return normalized;
  }

  private sanitizeTrace(rawText: string): string {
    return String(rawText ?? "")
      .replace(CONTROL_CHARS, "")
      .replace(ENV_PATTERN, "[redacted]")
      .replace(URL_SECRET_PATTERN, "$1?[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, TRACE_MAX_LENGTH);
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  private isFacing(value: string): value is Facing {
    return value === "up" || value === "down" || value === "left" || value === "right";
  }

  private isAdminOp(value: unknown): value is AdminOp {
    return (
      value === "start" ||
      value === "force_reveal" ||
      value === "soft_reset" ||
      value === "hard_reset" ||
      value === "enable_fallback"
    );
  }

  private isTraceEntryInput(value: unknown): value is TraceEntryInput {
    if (!value || typeof value !== "object") return false;
    const entry = value as Record<string, unknown>;
    return this.isTraceKind(entry.kind) && this.isTraceSource(entry.source) && typeof entry.text === "string";
  }

  private isTraceKind(value: unknown): value is TraceKind {
    return value === "reasoning" || value === "agentMessage" || value === "tool" || value === "meta";
  }

  private isTraceSource(value: unknown): value is TraceSource {
    return value === "appserver_raw" || value === "appserver_summary" || value === "responses_summary" || value === "bridge";
  }

  private minPlayers(): number {
    const parsed = Number(this.roomEnv().MIN_PLAYERS ?? "4");
    return Number.isFinite(parsed) ? Math.max(1, Math.min(12, Math.round(parsed))) : 4;
  }

  private demoMode(): boolean {
    const env = this.roomEnv();
    return env.DEMO_MODE === "1" || env.DEMO_MODE === "true";
  }

  private makeRoundId(): string {
    return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  private clearTimer(): void {
    if (!this.phaseTimer) return;
    clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
  }

  private setTimer(fn: () => void, delayMs: number): void {
    this.clearTimer();
    this.phaseTimer = setTimeout(fn, delayMs);
  }

  private pushBounded<T>(target: T[], item: T, limit: number): void {
    target.push(item);
    if (target.length > limit) target.splice(0, target.length - limit);
  }

  private send(conn: Party.Connection<ConnState>, msg: ServerMsg): void {
    this.sendRaw(conn, JSON.stringify(msg));
  }

  private sendRaw(conn: Party.Connection<ConnState>, payload: string): void {
    if (conn.readyState !== WebSocket.OPEN) return;
    try {
      conn.send(payload);
    } catch {
      // Closed PartyKit sockets can race with broadcasts during reconnect/reset.
    }
  }

  private close(conn: Party.Connection<ConnState>, code: number, reason: string): void {
    if (conn.readyState === WebSocket.CLOSING || conn.readyState === WebSocket.CLOSED) return;
    try {
      conn.close(code, reason.slice(0, 120));
    } catch {
      // A close racing another close is harmless.
    }
  }

  private closePlayerConnections(reason: string): void {
    for (const conn of this.room.getConnections<ConnState>()) {
      const role = conn.state?.role;
      if (role === "player" || role === "agentPlayer") this.close(conn, 1012, reason);
    }
  }

  private roomEnv(): Env {
    return (this.room.env ?? {}) as Env;
  }

  private broadcastMsg(msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const conn of this.room.getConnections<ConnState>()) {
      this.sendRaw(conn, payload);
    }
  }

  private sendError(conn: Party.Connection<ConnState>, code: ErrorCode, message: string): void {
    this.send(conn, { t: "error", code, message });
  }
}
