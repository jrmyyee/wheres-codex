import { EventEmitter } from "node:events";
import OpenAI from "openai";
import type { Landmark, TraceEntryInput } from "@wheres-codex/protocol";
import type { AgentDriver, AgentDriverEvents } from "./driver";
import { trace } from "./trace";
import type { ToolCall, ToolDef } from "./tools";

type PendingFunctionCall = {
  name: string | null;
  arguments: string;
};

const DEFAULT_MODEL = "gpt-5.3-codex";

export class ResponsesDriver extends EventEmitter<AgentDriverEvents> implements AgentDriver {
  readonly label = "responses";

  private readonly client: OpenAI;
  private readonly model: string;
  private nextRequestId = 1;

  constructor(
    private readonly dynamicTools: ToolDef[],
    configuredModel?: string,
  ) {
    super();
    this.client = new OpenAI();
    this.model = configuredModel ?? DEFAULT_MODEL;
  }

  async start(): Promise<string> {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for Responses fallback");
    this.emit("model", this.model);
    this.emit("trace", trace("meta", "bridge", `responses fallback ready. model ${this.model}`));
    return this.model;
  }

  async turn(input: string): Promise<void> {
    this.emit("trace", trace("meta", "bridge", "responses fallback turn started"));
    try {
      const toolCall = await this.runResponsesTurn(input);
      this.emit("toolCall", toolCall ?? this.scriptedToolCall(input));
      this.emit("completed");
    } catch (error) {
      this.emit("trace", trace("meta", "bridge", `responses fallback failed: ${errorMessage(error)}`));
      this.emit("toolCall", this.scriptedToolCall(input));
      this.emit("completed");
    }
  }

  ackToolCall(_requestId: number | string, _success: boolean, _text: string): void {
    return;
  }

  shutdown(): void {
    return;
  }

  private async runResponsesTurn(input: string): Promise<ToolCall | null> {
    const stream = await this.client.responses.create({
      stream: true,
      model: this.model,
      reasoning: { effort: "low", summary: "detailed" },
      tools: this.dynamicTools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        strict: true,
      })),
      input,
    } as any);

    const pendingByItem = new Map<string, PendingFunctionCall>();
    const emittedCallIds = new Set<string>();
    let firstToolCall: ToolCall | null = null;

    for await (const event of stream as unknown as AsyncIterable<any>) {
      this.handleTraceEvent(event);
      const call = this.toolCallFromEvent(event, pendingByItem, emittedCallIds);
      if (call && !firstToolCall) firstToolCall = call;
      if (event?.type === "response.failed") throw new Error(event.response?.error?.message ?? "response failed");
      if (event?.type === "response.error") throw new Error(event.error?.message ?? "response error");
    }

    return firstToolCall;
  }

  private handleTraceEvent(event: any): void {
    const type = String(event?.type ?? "");
    if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
      this.emitTrace(trace("reasoning", "responses_summary", String(event.delta ?? "")));
      return;
    }
    if (type === "response.output_text.delta") {
      this.emitTrace(trace("agentMessage", "responses_summary", String(event.delta ?? "")));
      return;
    }
    if (type === "response.output_item.added") {
      const itemType = event.item?.type;
      if (itemType === "function_call") this.emitTrace(trace("tool", "bridge", `responses tool call: ${event.item?.name ?? "unknown"}`));
      return;
    }
    if (type === "response.completed") this.emitTrace(trace("meta", "bridge", "responses turn completed"));
  }

  private toolCallFromEvent(event: any, pendingByItem: Map<string, PendingFunctionCall>, emittedCallIds: Set<string>): ToolCall | null {
    const type = String(event?.type ?? "");
    if (type === "response.output_item.added" && event.item?.type === "function_call") {
      const key = itemKey(event);
      pendingByItem.set(key, { name: String(event.item.name ?? ""), arguments: "" });
      return null;
    }
    if (type === "response.function_call_arguments.delta") {
      const key = itemKey(event);
      const pending = pendingByItem.get(key) ?? { name: null, arguments: "" };
      pending.arguments += String(event.delta ?? "");
      pendingByItem.set(key, pending);
      return null;
    }
    if (type === "response.function_call_arguments.done") {
      const key = itemKey(event);
      const pending = pendingByItem.get(key) ?? { name: null, arguments: "" };
      pending.arguments = String(event.arguments ?? pending.arguments);
      pendingByItem.set(key, pending);
      return null;
    }
    if (type === "response.output_item.done" && event.item?.type === "function_call") {
      const item = event.item;
      const key = item.id ?? item.call_id ?? item.output_index ?? item.item_id ?? "function_call";
      if (emittedCallIds.has(key)) return null;
      emittedCallIds.add(key);
      return this.toToolCall(String(item.name ?? ""), String(item.arguments ?? pendingByItem.get(key)?.arguments ?? "{}"), key);
    }
    return null;
  }

  private toToolCall(tool: string, rawArguments: string, requestId: string): ToolCall | null {
    if (tool !== "say" && tool !== "move" && tool !== "idle") return null;
    const parsed = parseArguments(rawArguments);
    this.emitTrace(trace("tool", "bridge", `tool call: ${tool}`));
    return { requestId: `responses-${requestId || this.nextRequestId++}`, tool, arguments: parsed };
  }

  private scriptedToolCall(input: string): ToolCall {
    const requestId = `responses-scripted-${this.nextRequestId++}`;
    if (/direct mention|suspicion|codex|bot|llm|ai/i.test(input)) {
      this.emitTrace(trace("tool", "bridge", "tool call: say"));
      return { requestId, tool: "say", arguments: { message: "yeah nah wrong person" } };
    }
    this.emitTrace(trace("tool", "bridge", "tool call: move"));
    return { requestId, tool: "move", arguments: { landmark: randomLandmark(input) } };
  }

  private emitTrace(entry: TraceEntryInput): void {
    if (entry.text) this.emit("trace", entry);
  }
}

function itemKey(event: any): string {
  return String(event.item_id ?? event.item?.id ?? event.output_index ?? event.call_id ?? "function_call");
}

function parseArguments(raw: string): { message?: string; landmark?: Landmark } {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return {};
  }
  return {};
}

function randomLandmark(input: string): Landmark {
  if (/coffee|quiet/i.test(input)) return "coffee_station";
  if (/heat|suspicion|codex|bot|llm|ai/i.test(input)) return "window";
  return Math.random() < 0.5 ? "pizza_table" : "desk_cluster_s";
}

function errorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 180);
}
