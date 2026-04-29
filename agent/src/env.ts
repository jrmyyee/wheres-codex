import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type AgentEnv = {
  partyHost: string;
  room: string;
  agentSecret: string;
  codexModel?: string;
  loadedEnvFiles: string[];
  openaiApiKeyPresent: boolean;
};

export function loadEnv(): AgentEnv {
  const loadedEnvFiles: string[] = [];
  for (const path of discoverEnvFiles(process.cwd())) {
    if (loadDotEnv(path)) loadedEnvFiles.push(path);
  }

  const partyHost = required("PARTY_HOST");
  const room = process.env.ROOM || "SGN-LOCAL";
  const agentSecret = required("AGENT_SECRET");
  const codexModel = process.env.CODEX_MODEL;
  const openaiApiKeyPresent = Boolean(process.env.OPENAI_API_KEY);
  return { partyHost, room, agentSecret, codexModel, loadedEnvFiles, openaiApiKeyPresent };
}

function discoverEnvFiles(startDir: string): string[] {
  const explicit = process.env.WHERES_CODEX_ENV_FILE ? [resolve(process.env.WHERES_CODEX_ENV_FILE)] : [];
  const workspaceRoot = findWorkspaceRoot(startDir) ?? startDir;
  const primaryRoot = findPrimaryWorktreeRoot(workspaceRoot);
  return unique([
    ...explicit,
    resolve(startDir, ".env"),
    resolve(startDir, "..", ".env"),
    join(workspaceRoot, ".env"),
    primaryRoot ? join(primaryRoot, ".env") : null,
  ]);
}

function findWorkspaceRoot(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findPrimaryWorktreeRoot(workspaceRoot: string): string | null {
  const dotGit = join(workspaceRoot, ".git");
  if (!existsSync(dotGit)) return null;
  if (statSync(dotGit).isDirectory()) return workspaceRoot;

  const gitFile = readFileSync(dotGit, "utf8").trim();
  const match = /^gitdir:\s*(.+)$/i.exec(gitFile);
  if (!match) return null;
  const gitDir = resolve(workspaceRoot, match[1]);
  const commonDirPath = join(gitDir, "commondir");
  if (!existsSync(commonDirPath)) return null;
  const commonGitDir = resolve(gitDir, readFileSync(commonDirPath, "utf8").trim());
  return dirname(commonGitDir);
}

function unique(paths: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

function loadDotEnv(path: string): boolean {
  if (!existsSync(path)) return false;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] === undefined) process.env[parsed.key] = parsed.value;
  }
  return true;
}

function parseDotEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const index = withoutExport.indexOf("=");
  if (index === -1) return null;
  const key = withoutExport.slice(0, index).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return { key, value: parseDotEnvValue(withoutExport.slice(index + 1).trim()) };
}

function parseDotEnvValue(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  const commentIndex = raw.search(/\s#/);
  return (commentIndex === -1 ? raw : raw.slice(0, commentIndex)).trim();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; set a non-empty value in root .env or the process environment`);
  return value;
}
