import type { ChatEntry, Player, Snapshot } from "@wheres-codex/protocol";

export type CadenceDecision = { action: "speak" | "walk" | "idle"; delayMs: number; reason: string };

export function decideCadence(snapshot: Snapshot, self: Player, lastTurnAt: number): CadenceDecision {
  const recent = snapshot.chatLog.slice(-8);
  const now = Date.now();
  const direct = recent.some((entry) => entry.id !== self.id && mentionsSelf(entry, self.num));
  const suspicious = recent.some((entry) => entry.id !== self.id && /ai|codex|bot|llm|sus|robot/i.test(entry.text));
  const movingOthers = snapshot.players.filter((player) => player.id !== self.id && !player.isGhost && player.moving).length;
  const quietMs = recent.length ? now - recent[recent.length - 1].ts : 60_000;

  if (now - lastTurnAt < 1_800) return { action: "idle", delayMs: jitter(700, 1_500), reason: "cooldown" };
  if (direct || suspicious) return { action: "speak", delayMs: jitter(700, 2_200), reason: direct ? "direct mention" : "suspicion nearby" };
  if (movingOthers > 0 && Math.random() < 0.7) return { action: "walk", delayMs: jitter(450, 1_500), reason: "following room movement" };
  if (quietMs > 12_000) return { action: "walk", delayMs: jitter(450, 1_800), reason: "quiet room" };
  if (Math.random() < 0.35) return { action: "idle", delayMs: jitter(1_000, 2_500), reason: "human skip" };
  return Math.random() < 0.7
    ? { action: "walk", delayMs: jitter(700, 2_400), reason: "background movement" }
    : { action: "speak", delayMs: jitter(1_400, 3_500), reason: "ambient reply" };
}

function mentionsSelf(entry: ChatEntry, num: string): boolean {
  return new RegExp(`(^|\\D)${num.replace(/^0/, "0?")}(\\D|$)`).test(entry.text);
}

function jitter(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}
