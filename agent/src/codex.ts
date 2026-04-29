import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import readline from "node:readline";
import { trace } from "./trace";
import type { ToolCall, ToolDef } from "./tools";
import type { TraceEntryInput } from "@wheres-codex/protocol";

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type CodexEvents = {
  trace: [TraceEntryInput];
  toolCall: [ToolCall];
  completed: [];
  model: [string];
};

const optOutNotificationMethods = [
  "turn/diff/updated",
  "item/commandExecution/outputDelta",
  "item/fileChange/patchUpdated",
  "item/fileChange/outputDelta",
  "thread/tokenUsage/updated",
];

export class Codex extends EventEmitter<CodexEvents> {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
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
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env,
    });
    if (!proc.stdout || !proc.stdin) throw new Error("failed to open App Server stdio");
    this.proc = proc;
    this.rl = readline.createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => this.onLine(line));

    await this.send("initialize", {
      clientInfo: { name: "wheres-codex", title: "where's codex", version: "0.1.0" },
      capabilities: { experimentalApi: true, optOutNotificationMethods },
    });
    this.notify("initialized");

    const modelList = (await this.send("model/list", { limit: 50, includeHidden: true })) as { data?: Array<{ id: string; model: string; isDefault?: boolean; displayName?: string }> };
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
      45_000,
    )) as { thread?: { id?: string } };
    this.threadId = res.thread?.id ?? null;
    if (!this.threadId) throw new Error("App Server did not return thread id");
    return this.selectedModel;
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
    this.proc?.kill();
  }

  private send(method: string, params?: object, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    if (!this.proc?.stdin) throw new Error("App Server stdin is closed");
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
    });
  }

  private notify(method: string, params?: object): void {
    this.proc?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private respond(id: number | string, result: object): void {
    this.proc?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
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
    if (
      msg.method === "item/commandExecution/requestApproval" ||
      msg.method === "item/fileChange/requestApproval" ||
      msg.method === "item/permissions/requestApproval" ||
      msg.method === "mcpServer/elicitation/request" ||
      msg.method === "applyPatchApproval" ||
      msg.method === "execCommandApproval"
    ) {
      this.respond(msg.id, { decision: "decline" });
      return;
    }

    if (msg.method === "item/tool/call") {
      const tool = String(msg.params?.tool ?? "");
      if (tool === "say" || tool === "move" || tool === "idle") {
        this.emit("trace", trace("tool", "bridge", `tool call: ${tool}`));
        this.emit("toolCall", { requestId: msg.id, tool, arguments: msg.params?.arguments ?? {} });
        return;
      }
    }

    this.respond(msg.id, {
      contentItems: [{ type: "inputText", text: "unsupported request declined" }],
      success: false,
    });
  }

  private handleNotification(method: string, params: any): void {
    if (method === "item/reasoning/textDelta") {
      this.emit("trace", trace("reasoning", "appserver_raw", String(params?.delta ?? "")));
    }
    if (method === "item/reasoning/summaryTextDelta") {
      this.emit("trace", trace("reasoning", "appserver_summary", String(params?.delta ?? "")));
    }
    if (method === "item/agentMessage/delta") {
      this.emit("trace", trace("agentMessage", "appserver_raw", String(params?.delta ?? "")));
    }
    if (method === "item/started") {
      const type = params?.item?.type;
      if (type === "reasoning" || type === "dynamicToolCall" || type === "agentMessage") {
        this.emit("trace", trace("meta", "bridge", `appserver item: ${type}`));
      }
      if (type === "commandExecution" || type === "fileChange" || type === "webSearch") {
        this.emit("trace", trace("meta", "bridge", `blocked built-in tool attempt: ${type}`));
      }
    }
    if (method === "turn/completed") {
      this.emit("trace", trace("meta", "bridge", "turn completed"));
      this.emit("completed");
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
