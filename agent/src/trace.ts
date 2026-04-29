import type { TraceEntryInput, TraceKind, TraceSource } from "@wheres-codex/protocol";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const SECRETISH = /(sk-[a-zA-Z0-9_-]{16,}|[A-Z0-9_]{12,}=[^\s]+)/g;
const URL_SECRET = /(https?:\/\/[^\s?]+)\?[^\s]+/g;

export function trace(kind: TraceKind, source: TraceSource, text: string): TraceEntryInput {
  return {
    kind,
    source,
    text: normalizeTraceText(text),
  };
}

export function normalizeTraceText(text: string): string {
  return text
    .replace(CONTROL_CHARS, "")
    .replace(SECRETISH, "[redacted]")
    .replace(URL_SECRET, "$1?[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
