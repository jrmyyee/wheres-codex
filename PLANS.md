# PLANS.md — live progress log

> You (Codex) maintain this file continuously as you build. The user reads it to know where you are. Future-you reads it on `codex resume`. Keep it terse, timestamped, honest.

## Goals

- Ship `wheres-codex` end-to-end by hour 8 of the build day (2026-04-29).
- Live public web URL (`PUBLIC_WEB_URL`) serving the Vite app; it connects to PartyKit backend via `PARTY_HOST`.
- Codex App Server reasoning trace visible on `/projector` route.
- 3 rounds completable end-to-end without server crash.
- Win the OpenAI Codex Hackathon Sydney.

## Next Agent Launch Prompt

Use this prompt to start the build agent:

```text
Read AGENTS.md first, then SPEC.md, then PLANS.md. Build wheres-codex end-to-end, not just a plan: a pnpm workspace with packages/protocol, party, web, and agent, maintaining PLANS.md continuously with timestamped progress, decisions, surprises, validation output, and blockers.

Start with H0 only: prove Codex App Server or fallback before investing in polish. First run the App Server preflight: initialize, model/list or configured CODEX_MODEL, thread/start with cwd /tmp/wheres-codex-scratch, approvalPolicy never, dynamicTools say/move/idle, one turn/start with the system anchor, at least one trace notification, and one say or move tool call. Implement the approval interceptor. If not green within the H0 budget or Codex calls built-in tools despite mitigations, record it in PLANS.md and switch immediately to the Responses API fallback driver.

After preflight is green or fallback is selected, scaffold/build serially in this order: lock packages/protocol/src/index.ts; implement PartyKit authoritative server with secrets, reconnect sessions, roster, movement, chat rate limits, trace buffer, admin/projector roles; implement mobile web, projector, and admin routes; integrate agent as agentPlayer; implement voting/ghost/reveal; deploy. Use only allowed dependencies and canonical import paths from AGENTS.md. Use 127.0.0.1, pnpm only, and timeout-wrapped dev-server probes. Never run long-lived dev commands directly.

Use /Users/jrmyyee/Documents/Projects/saigon-rush as a read-only ambiguity reducer when helpful. Adapt its proven patterns only: one static app with role routes, a single role/session WebSocket wrapper, projector-generated room QR from the web origin, role-tagged server sessions, bounded queues/buffers, and static-web/backend deployment split with SPA rewrites. Do not adopt its React/Bun/Tailwind/npm stack.

Parallelism rule: do not fork or split work until PLANS.md shows a green App Server or fallback-agent preflight, the protocol is locked, and the repo has the baseline commit. If those are true, suggest optional worktrees for user-run parallel sessions; do not initiate unattended parallel worktrees yourself.

Verification is mandatory before claiming any phase done: run package build/typecheck commands, timeout/curl server smoke tests where relevant, paste success/status/body snippets into PLANS.md, reconcile pending items, and leave no TODO/not-implemented stubs. Optimize for a demoable public URL by hour 8: QR join, phone multiplayer, Codex as a numbered player, wrong-vote ghosting, correct/timer/host reveal with real normalized trace, and three rounds without crash.
```

## Milestones (from SPEC.md §11)

- [ ] **H0 (0:00 – 0:30)** — App Server spike + scaffold. Prove `codex app-server` dynamicTools/trace or choose Responses fallback, then scaffold pnpm workspace.
  - Validation: console shows one traceable event + a `say` or `move` tool call, OR `AgentDriver=responses` fallback is selected and recorded.
- [ ] **H1 (0:30 – 1:30)** — PartyKit `Lobby` server: protocol locked, `agentPlayer`, `agentTrace`, admin/projector secrets, reconnect session, roster, position, chat, trace buffer.
  - Validation: 2 browser tabs + fake agent player see move/chat; server buffers trace; admin can start/reset.
- [ ] **H2 (1:30 – 3:00)** — Web client + deployable shell: rule card, self highlight, assets, sprites, office, movement, chat, greyed vote grid, projector/admin routes.
  - Validation: mobile Safari loads public/local URL; `/projector` and `/admin` render; 4-tab multiplayer works.
- [ ] **H3 (3:00 – 4:00)** — Public hosting proof + agent integration.
  - Validation: phone on non-dev network can join; Codex/fallback appears as voteable number; trace buffer reaches PartyKit.
- [ ] **H4 (4:00 – 5:00)** — Agent bridge connects to PartyKit as `agentPlayer`. Local cadence heuristic. End-to-end round (no reveal).
  - Validation: chat with Codex; it walks; doesn't say "as an AI".
- [ ] **H5 (5:00 – 6:00)** — Voting: 30s lockout, grid logic, vote msg, eliminated handling, ghost rendering, hot-vote → reveal.
  - Validation: wrong vote eliminates you; correct vote ends round.
- [ ] **H6 (6:00 – 7:00)** — Reveal: minimal split-screen chat log + normalized trace log, AI highlight, final outcome.
  - Validation: reveal plays end-of-round on projector + winner's phone.
- [ ] **H7 (7:00 – 7:45)** — Office polish: wall, plants, monitors, pizza, coffee, lighting overlay.
  - Validation: photographable on a phone screenshot.
- [ ] **H8 (7:45 – 8:00)** — Final deploy, QR, 3-phone smoke, three consecutive rounds. README only if time remains.
  - Validation: public URL works; QR scans on real phones; reset works; three rounds do not crash.

---

## Progress

(Append a timestamped checkpoint every 30 minutes of wall time. Format: `### t+HH:MM — <what works end-to-end RIGHT NOW>`)

---

## Validation

(Paste here the exact commands you ran and their output. Build success lines, curl status codes + first 100 bytes of body, deploy URL on success.)

### Prep — 2026-04-29T03:50:59Z

`command -v codex && codex --version`
```
/opt/homebrew/bin/codex
WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)
codex-cli 0.125.0
```

`codex app-server --help`
```
WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)
[experimental] Run the app server or related tooling
Usage: codex app-server [OPTIONS] [COMMAND]
Commands: proxy, generate-ts, generate-json-schema, help
```

`node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('vercel.json valid')"`
```
vercel.json valid
```

---

## Surprises & Discoveries

(When SPEC.md is wrong about a detail, or a library has changed shape since the spec was written, or a setting that was supposed to work doesn't — record it here with: what you expected, what happened, what you did instead.)

---

## Decisions

(When you make a choice not explicit in SPEC.md, record it here. One line: `<decision> — <reason>`.)

- Saigon Rush implementation is a read-only reference — it already solved role routes, QR/lobby flow, session WebSocket wrappers, buffer caps, and static-web/backend deploy split for a real hackathon game.

---

## Stuck

(If you hit a wall and can't proceed after 3 attempts, write a `### Stuck — <timestamp>` block describing: what you tried, what failed, what you suspect, what you'd try next. Then end the turn.)

---

## Final report

(At end of build, summarize what shipped, what didn't, what's known-broken, and the public URL.)
