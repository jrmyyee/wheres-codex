import type { ChatEntry, Player, Snapshot } from "@wheres-codex/protocol";

export type CadenceDecision = { action: "speak" | "walk" | "idle"; delayMs: number; reason: string };

export function decideCadence(snapshot: Snapshot, self: Player, lastTurnAt: number): CadenceDecision {
  const recent = snapshot.chatLog.slice(-8);
  const now = Date.now();
  const direct = recent.some((entry) => entry.id !== self.id && mentionsSelf(entry, self.num));
  const suspicious = recent.some((entry) => entry.id !== self.id && /ai|codex|bot|llm|sus|robot/i.test(entry.text));
  const quietMs = recent.length ? now - recent[recent.length - 1].ts : 60_000;

  if (now - lastTurnAt < 3_500) return { action: "idle", delayMs: jitter(2_000, 4_000), reason: "cooldown" };
  if (direct || suspicious) return { action: "speak", delayMs: jitter(1_500, 4_500), reason: direct ? "direct mention" : "suspicion nearby" };
  if (quietMs > 35_000) return { action: "walk", delayMs: jitter(1_000, 3_000), reason: "quiet room" };
  if (Math.random() < 0.68) return { action: "idle", delayMs: jitter(3_000, 7_000), reason: "human skip" };
  return Math.random() < 0.55
    ? { action: "walk", delayMs: jitter(2_000, 6_000), reason: "background movement" }
    : { action: "speak", delayMs: jitter(3_000, 8_000), reason: "ambient reply" };
}

function mentionsSelf(entry: ChatEntry, num: string): boolean {
  return new RegExp(`(^|\\D)${num.replace(/^0/, "0?")}(\\D|$)`).test(entry.text);
}

function jitter(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}
