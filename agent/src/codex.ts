import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import readline from "node:readline";
import type { AgentDriver, AgentDriverEvents } from "./driver";
import { normalizeTraceText, trace } from "./trace";
import type { ToolCall, ToolDef } from "./tools";
import type { TraceEntryInput } from "@wheres-codex/protocol";

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const optOutNotificationMethods = [
  "turn/diff/updated",
  "item/commandExecution/outputDelta",
  "item/fileChange/patchUpdated",
  "item/fileChange/outputDelta",
  "thread/tokenUsage/updated",
];

const DEFAULT_START_TIMEOUT_MS = 45_000;

export class Codex extends EventEmitter<AgentDriverEvents> implements AgentDriver {
  readonly label = "appserver";

  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private stderr: readline.Interface | null = null;
  private stderrTail: string[] = [];
  private nextId = 1;
  private threadId: string | null = null;
  private pending = new Map<number, Pending>();
  private selectedModel: string | null = null;

  constructor(
    private readonly dynamicTools: ToolDef[],
    private readonly configuredModel?: string,
  ) {
    super();
  }

  async start(): Promise<string> {
    mkdirSync("/tmp/wheres-codex-scratch", { recursive: true });
    const proc = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    if (!proc.stdout || !proc.stdin) throw new Error("failed to open App Server stdio");
    this.proc = proc;
    this.rl = readline.createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => this.onLine(line));
    if (proc.stderr) {
      this.stderr = readline.createInterface({ input: proc.stderr });
      this.stderr.on("line", (line) => this.onStderr(line));
    }
    proc.once("error", (error) => this.failPending(`app-server process error: ${error.message}`));
    proc.once("exit", (code, signal) => {
      if (this.pending.size > 0) this.failPending(`app-server exited before responding: code ${code ?? "null"} signal ${signal ?? "null"}`);
    });

    const startupTimeoutMs = appServerStartTimeoutMs();
    try {
      await this.send("initialize", {
        clientInfo: { name: "wheres-codex", title: "where's codex", version: "0.1.0" },
        capabilities: { experimentalApi: true, optOutNotificationMethods },
      }, startupTimeoutMs);
      this.notify("initialized");

      const modelList = (await this.send("model/list", { limit: 50, includeHidden: true }, startupTimeoutMs)) as { data?: Array<{ id: string; model: string; isDefault?: boolean; displayName?: string }> };
      this.selectedModel = this.pickModel(modelList.data ?? []);
      this.emit("model", this.selectedModel);

      const res = (await this.send(
        "thread/start",
        {
          model: this.selectedModel,
          cwd: "/tmp/wheres-codex-scratch",
          approvalPolicy: "never",
          sandbox: "read-only",
          ephemeral: true,
          dynamicTools: this.dynamicTools,
          experimentalRawEvents: false,
          persistExtendedHistory: false,
        },
        startupTimeoutMs,
      )) as { thread?: { id?: string } };
      this.threadId = res.thread?.id ?? null;
      if (!this.threadId) throw new Error("App Server did not return thread id");
      this.emitTrace(trace("meta", "bridge", `appserver ready. model ${this.selectedModel}`));
      return this.selectedModel;
    } catch (error) {
      const suffix = this.stderrTail.length ? ` stderr: ${this.stderrTail.join(" | ")}` : "";
      this.shutdown();
      throw new Error(`${errorMessage(error)}${suffix}`);
    }
  }

  async turn(input: string): Promise<void> {
    if (!this.threadId) throw new Error("Codex driver is not started");
    await this.send(
      "turn/start",
      {
        threadId: this.threadId,
        effort: "low",
        summary: "detailed",
        cwd: "/tmp/wheres-codex-scratch",
        approvalPolicy: "never",
        input: [{ type: "text", text: input, text_elements: [] }],
      },
      45_000,
    );
  }

  ackToolCall(requestId: number | string, success: boolean, text: string): void {
    this.respond(requestId, { contentItems: [{ type: "inputText", text }], success });
  }

  shutdown(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex driver shutdown"));
    }
    this.pending.clear();
    this.rl?.close();
    this.stderr?.close();
    this.proc?.kill();
  }

  private send(method: string, params?: object, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    if (!this.proc?.stdin) throw new Error("App Server stdin is closed");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.proc?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        reject(error);
      });
    });
  }

  private notify(method: string, params?: object): void {
    this.proc?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private respond(id: number | string, result: object): void {
    this.proc?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  private onStderr(line: string): void {
    const text = normalizeTraceText(line);
    if (!text) return;
    this.stderrTail.push(text);
    this.stderrTail = this.stderrTail.slice(-6);
    console.error(`[agent] appserver stderr: ${text}`);
  }

  private onLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(Number(msg.id));
      if (!pending) return;
      this.pending.delete(Number(msg.id));
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(`${pending.method}: ${msg.error.message ?? "app-server error"}`));
      else pending.resolve(msg.result);
      return;
    }

    if (msg.id !== undefined && msg.method) {
      this.handleServerRequest(msg);
      return;
    }

    if (msg.method) this.handleNotification(msg.method, msg.params);
  }

  private handleServerRequest(msg: { id: number | string; method: string; params?: any }): void {
    if (isApprovalRequest(msg.method)) {
      this.respond(msg.id, { decision: "decline" });
      this.emitTrace(trace("meta", "bridge", `declined approval request: ${msg.method}`));
      return;
    }

    if (msg.method === "item/tool/call") {
      const tool = String(msg.params?.tool ?? msg.params?.name ?? "");
      if (tool === "say" || tool === "move" || tool === "idle") {
        this.emitTrace(trace("tool", "bridge", `tool call: ${tool}`));
        this.emit("toolCall", { requestId: msg.id, tool, arguments: parseToolArguments(msg.params?.arguments) });
        return;
      }
      this.emitTrace(trace("meta", "bridge", `declined unsupported tool: ${tool || "unknown"}`));
    }

    this.respond(msg.id, {
      contentItems: [{ type: "inputText", text: "unsupported request declined" }],
      success: false,
    });
  }

  private handleNotification(method: string, params: any): void {
    if (method === "item/reasoning/textDelta") {
      this.emitTrace(trace("reasoning", "appserver_raw", String(params?.delta ?? "")));
    }
    if (method === "item/reasoning/summaryTextDelta") {
      this.emitTrace(trace("reasoning", "appserver_summary", String(params?.delta ?? "")));
    }
    if (method === "item/agentMessage/delta") {
      this.emitTrace(trace("agentMessage", "appserver_raw", String(params?.delta ?? "")));
    }
    if (method === "item/started") {
      const type = params?.item?.type;
      if (type === "reasoning" || type === "dynamicToolCall" || type === "agentMessage") {
        this.emitTrace(trace("meta", "bridge", `appserver item: ${type}`));
      }
      if (type === "commandExecution" || type === "fileChange" || type === "webSearch") {
        this.emitTrace(trace("meta", "bridge", `blocked built-in tool attempt: ${type}`));
      }
    }
    if (method === "turn/completed") {
      this.emitTrace(trace("meta", "bridge", "turn completed"));
      this.emit("completed");
    }
  }

  private emitTrace(entry: TraceEntryInput): void {
    if (entry.text) this.emit("trace", entry);
  }

  private failPending(message: string): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error(`${pending.method}: ${message}`));
    }
  }

  private pickModel(models: Array<{ id: string; model: string; isDefault?: boolean; displayName?: string }>): string {
    if (this.configuredModel) return this.configuredModel;
    for (const candidate of ["gpt-5.3-codex", "gpt-5.1-codex"]) {
      const found = models.find((model) => model.model === candidate || model.id === candidate);
      if (found) return found.model || found.id;
    }
    const codex = models.find((model) => /codex/i.test(`${model.model} ${model.id} ${model.displayName ?? ""}`));
    if (codex) return codex.model || codex.id;
    const fallback = models.find((model) => model.isDefault) ?? models[0];
    return fallback?.model || fallback?.id || "gpt-5.3-codex";
  }
}

function isApprovalRequest(method: string): boolean {
  return (
    method.endsWith("/requestApproval") ||
    method === "mcpServer/elicitation/request" ||
    method === "applyPatchApproval" ||
    method === "execCommandApproval" ||
    method.toLowerCase().includes("approval")
  );
}

function parseToolArguments(value: unknown): ToolCall["arguments"] {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as ToolCall["arguments"];
  return {};
}

function appServerStartTimeoutMs(): number {
  const raw = Number(process.env.CODEX_APP_SERVER_START_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_START_TIMEOUT_MS;
}

function errorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 220);
}
