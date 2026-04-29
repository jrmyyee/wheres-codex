import type { EventEmitter } from "node:events";
import type { TraceEntryInput } from "@wheres-codex/protocol";
import type { ToolCall } from "./tools";

export type AgentDriverEvents = {
  trace: [TraceEntryInput];
  toolCall: [ToolCall];
  completed: [];
  model: [string];
};

export type AgentDriver = EventEmitter<AgentDriverEvents> & {
  readonly label: string;
  start(): Promise<string>;
  turn(input: string): Promise<void>;
  ackToolCall(requestId: number | string, success: boolean, text: string): void;
  shutdown(): void;
};
