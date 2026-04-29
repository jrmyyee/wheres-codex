import PartySocket from "partysocket";
import type { ClientMsg, Role, ServerMsg } from "@wheres-codex/protocol";

export type GameSocket = PartySocket & {
  sendMsg(msg: ClientMsg): void;
};

export type SocketOptions = {
  room: string;
  role: Role;
  sessionId?: string;
  secret?: string;
  onMessage: (msg: ServerMsg) => void;
  onStatus?: (status: "connecting" | "open" | "closed") => void;
};

export function createGameSocket(options: SocketOptions): GameSocket {
  const socket = new PartySocket({
    host: partyHost(),
    party: "main",
    room: options.room,
    protocol: partyProtocol(),
    query: () => ({
      as: options.role,
      sessionId: options.sessionId,
      secret: options.secret,
    }),
  }) as GameSocket;

  socket.sendMsg = (msg: ClientMsg) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  };
  socket.addEventListener("open", () => options.onStatus?.("open"));
  socket.addEventListener("close", () => options.onStatus?.("closed"));
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      options.onMessage(JSON.parse(event.data) as ServerMsg);
    } catch {
      // Ignore malformed server frames; the next snapshot will resync state.
    }
  });
  options.onStatus?.("connecting");
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && socket.readyState !== WebSocket.OPEN) socket.reconnect();
  });
  return socket;
}

function partyHost(): string {
  const configured = import.meta.env.VITE_PARTY_HOST || "127.0.0.1:1999";
  return String(configured).replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "");
}

function partyProtocol(): "ws" | "wss" {
  const configured = String(import.meta.env.VITE_PARTY_HOST || "");
  if (configured.startsWith("https://") || configured.startsWith("wss://")) return "wss";
  if (configured.startsWith("http://") || configured.startsWith("ws://")) return "ws";
  return window.location.protocol === "https:" ? "wss" : "ws";
}
