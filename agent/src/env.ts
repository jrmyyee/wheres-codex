import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type AgentEnv = {
  partyHost: string;
  room: string;
  agentSecret: string;
  codexModel?: string;
};

export function loadEnv(): AgentEnv {
  loadDotEnv(resolve(process.cwd(), "..", ".env"));
  loadDotEnv(resolve(process.cwd(), ".env"));

  const partyHost = required("PARTY_HOST");
  const room = process.env.ROOM || "SGN-LOCAL";
  const agentSecret = required("AGENT_SECRET");
  const codexModel = process.env.CODEX_MODEL;
  return { partyHost, room, agentSecret, codexModel };
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
