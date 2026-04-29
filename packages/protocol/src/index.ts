export const MAP_WIDTH = 624;
export const MAP_HEIGHT = 528;
export const MAX_HUMANS_ACTIVE = 12;
export const MAX_HUMANS_LOBBY = 15;
export const MAX_PLAYERS_TOTAL = 15;
export const CHAT_LIMIT = 120;
export const TRACE_LIMIT = 240;
export const CHAT_MAX_LENGTH = 200;
export const TRACE_MAX_LENGTH = 240;
export const RECONNECT_GRACE_MS = 60_000;
export const CHAT_MIN_INTERVAL_MS = 800;
export const CHAT_BURST_WINDOW_MS = 30_000;
export const CHAT_BURST_LIMIT = 20;
export const MOVE_MIN_INTERVAL_MS = 80;
export const TRACE_RATE_LIMIT_PER_SEC = 10;
export const ROLLIN_MS = 2_500;
export const ACTIVE_MS = 210_000;
export const ACTIVE_DEMO_MS = 75_000;
export const VOTE_LOCKOUT_MS = 8_000;
export const VOTE_LOCKOUT_DEMO_MS = 2_000;
export const REVEAL_MS = 20_000;
export const OUTRO_MS = 5_000;

export type Facing = "up" | "down" | "left" | "right";
export type Role = "player" | "agentPlayer" | "projector" | "admin";
export type Phase = "lobby" | "rollin" | "active" | "reveal" | "outro";
export type AdminOp = "start" | "force_reveal" | "soft_reset" | "hard_reset" | "enable_fallback";
export type TraceKind = "reasoning" | "agentMessage" | "tool" | "meta";
export type TraceSource = "appserver_raw" | "appserver_summary" | "responses_summary" | "bridge";
export type ErrorCode =
  | "vote_locked"
  | "invalid_target"
  | "rate_limited"
  | "phase_mismatch"
  | "room_full"
  | "not_host"
  | "agent_not_ready"
  | "bad_secret"
  | "reconnect_failed";

export type Player = {
  id: string;
  num: string;
  spriteIndex: number;
  hue: number;
  sat: number;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  isGhost: boolean;
  hasVoted: boolean;
  connected: boolean;
};

export type ChatEntry = { id: string; text: string; ts: number };
export type TraceEntryInput = { kind: TraceKind; text: string; source: TraceSource };
export type TraceEntry = TraceEntryInput & { ts: number; seq: number };

export type RevealReason = "correct_vote" | "timer" | "all_eliminated" | "host";

export type Snapshot = {
  you: string | null;
  roundId: string;
  roomCode: string;
  serverNow: number;
  phase: Phase;
  phaseEndsAt: number;
  voteLockoutEndsAt: number;
  players: Player[];
  chatLog: ChatEntry[];
  tracePreview?: TraceEntry[];
  agentReady: boolean;
  agentModel?: string;
  fallbackAgentEnabled: boolean;
  winnerId: string | null;
  revealReason: RevealReason | null;
  votesCast: number;
  minPlayers: number;
  demoMode: boolean;
};

export type ClientMsg =
  | { t: "hello"; sessionId: string }
  | { t: "move"; x: number; y: number; facing: Facing }
  | { t: "chat"; text: string }
  | { t: "vote"; targetId: string }
  | { t: "startRound" }
  | { t: "agentTrace"; entry: TraceEntryInput }
  | { t: "agentReady"; ready: boolean; model?: string }
  | { t: "admin"; secret: string; op: AdminOp };

export type ServerMsg =
  | { t: "init"; snapshot: Snapshot }
  | { t: "snapshot"; snapshot: Snapshot }
  | { t: "roster"; players: Player[] }
  | { t: "pos"; id: string; x: number; y: number; facing: Facing; moving: boolean }
  | { t: "chat"; id: string; text: string; ts: number }
  | { t: "phase"; phase: Phase; phaseEndsAt: number; voteLockoutEndsAt?: number }
  | { t: "voteCount"; tally: Record<string, number>; votesCast: number }
  | { t: "eliminated"; playerId: string }
  | {
      t: "reveal";
      aiId: string;
      voterId: string | null;
      reason: RevealReason;
      chatLog: ChatEntry[];
      trace: TraceEntry[];
    }
  | { t: "trace"; entry: TraceEntry }
  | { t: "error"; code: ErrorCode; message: string };

export type Landmark =
  | "coffee_station"
  | "whiteboard"
  | "sofa_area"
  | "pizza_table"
  | "desk_cluster_n"
  | "desk_cluster_s"
  | "desk_cluster_e"
  | "desk_cluster_w"
  | "window"
  | "entrance"
  | "idle_corner";

export const LANDMARKS: Record<Landmark, { x: number; y: number }> = {
  coffee_station: { x: 9 * 48, y: 1 * 48 },
  whiteboard: { x: 6 * 48, y: 1 * 48 },
  sofa_area: { x: 5 * 48, y: 8 * 48 },
  pizza_table: { x: 6 * 48, y: 5 * 48 },
  desk_cluster_n: { x: 2 * 48, y: 2 * 48 },
  desk_cluster_s: { x: 2 * 48, y: 8 * 48 },
  desk_cluster_e: { x: 10 * 48, y: 5 * 48 },
  desk_cluster_w: { x: 1 * 48, y: 5 * 48 },
  window: { x: 4 * 48, y: 1 * 48 },
  entrance: { x: 6 * 48, y: 10 * 48 },
  idle_corner: { x: 11 * 48, y: 9 * 48 },
};

export function isFacing(value: unknown): value is Facing {
  return value === "up" || value === "down" || value === "left" || value === "right";
}

export function isLandmark(value: unknown): value is Landmark {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LANDMARKS, value);
}
