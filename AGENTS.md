# AGENTS.md — operational guide for Codex

> Read this BEFORE you read SPEC.md. It tells you how to operate in this repo. SPEC.md tells you what to build.

## TL;DR

You're building `wheres-codex` — a multiplayer 2D office-lobby game where one player is you (Codex). Three services in a pnpm workspace: `web/`, `party/`, `agent/`, plus `packages/protocol/`. Full design in `SPEC.md`. Maintain `PLANS.md` continuously as you build (timestamped progress, blockers, decisions). Hackathon shipping deadline is the same day as the build start. Demo URL must be live by hour 8.

**Plan first, then execute.** On kickoff, reply with a 1-sentence acknowledgement + a 1-2 sentence plan, then start. Do not end the conversation with only a plan — the deliverable is working code.

---

## Proven Reference: Saigon Rush

`/Users/jrmyyee/Documents/Projects/saigon-rush` is a previous real-time hackathon game. Treat it as read-only implementation reference only — adapt patterns, do not copy its React/Bun/Tailwind stack or npm workflow.

Useful files to inspect if ambiguity appears:

- `/Users/jrmyyee/Documents/Projects/saigon-rush/client/src/App.tsx` — one static client app owns multiple role routes.
- `/Users/jrmyyee/Documents/Projects/saigon-rush/client/src/lib/ws.ts` — centralized role/session WebSocket wrapper with reconnect.
- `/Users/jrmyyee/Documents/Projects/saigon-rush/client/src/pages/GameScreen.tsx` — room code, join URL, embedded QR, live count patterns.
- `/Users/jrmyyee/Documents/Projects/saigon-rush/server/index.ts` — per-session map, role-tagged sockets, queue caps, deterministic fallback.
- `/Users/jrmyyee/Documents/Projects/saigon-rush/vercel.json` and `fly.toml` — static web deploy split from WebSocket backend with SPA rewrites and origin env.

---

## Runtime (pinned)

- Node **22.x target runtime** (`.nvmrc` pins `22.15.0`). If the local shell is newer, record it in `PLANS.md` and continue unless a dependency/runtime check fails. Do not intentionally downgrade/upgrade Node mid-build without user approval.
- pnpm **9.x** (workspace-aware). Do not use `npm` or `yarn` for installs — `pnpm-lock.yaml` is the source of truth.
- TypeScript **5.6** strict.
- Use **`127.0.0.1`** in URLs, not `localhost` (macOS resolves `localhost` → IPv6 `::1`, several dev servers bind IPv4 only).

If `node --version` is not Node 22, activate the pinned runtime in the current shell:

```bash
source ~/.nvm/nvm.sh && nvm use && export PATH="$NVM_BIN:$PATH"
node --version
pnpm --version
```

## Allowed dependencies (allowlist — do not add others without approval)

```
runtime:
  partykit              ^0.0.x   (party/, latest at install time)
  partyserver           ^0.0.x   (party/, the new export path)
  partysocket           ^1.x     (web/ + agent/)
  openai                ^5.x     (agent/, for Responses API + cadence gate)
  qrcode                ^1.5.4   (web/, projector/admin embedded join QR)
  vite                  ^6.x     (web/)
  typescript            ^5.6     (all)
  tsx                   ^4.x     (agent/, for dev runtime)

dev:
  @types/node           ^22.x
  @types/qrcode         ^1.5.4   (web/)
  @types/web            latest   (web/, DOM types)
```

**Before adding ANY package not on this list:** run `npm view <name> versions --json`, paste the latest stable version into `PLANS.md` under "Surprises", and stop. Do not invent package names. Do not bump major versions without surfacing the change.

Common hallucinations to avoid:
- `partykit/server` is the OLD import path — use **`partyserver`** as the package and `import { Server } from 'partyserver'`.
- `@openai/codex` is the **CLI binary**, installed globally (`npm i -g @openai/codex`) — not a runtime dep of our project.
- `CODEX_MODEL` is the model name passed to App Server's `thread/start`; it is not a separate package. Prefer the current Codex model available from `model/list` or `.env`.

## Canonical import paths (verify against `node_modules/<pkg>/package.json` if uncertain)

```ts
import type * as Party from 'partykit/server';     // type-only, framework boundary
import { Server } from 'partyserver';              // class to extend
import PartySocket from 'partysocket';             // client transport
import OpenAI from 'openai';                       // standard
```

## Scope (where you may write)

You may edit files under:
```
web/   party/   agent/   packages/   package.json   pnpm-lock.yaml   PLANS.md   .env.example   .nvmrc   vercel.json
```

Do not touch:
```
.git/  .github/  AGENTS.md  SPEC.md  README.md  .env
```

If you believe one of the read-only files needs updating, write a "Proposed change to AGENTS.md" entry in `PLANS.md` and continue without editing it.

## Non-goals (do not implement)

- Authentication, accounts, login, or persistent server-side user profiles. Anonymous `localStorage` `sessionId` reconnect tokens are allowed and required by `SPEC.md`.
- Tests beyond a single lightweight smoke verification. Prefer build/typecheck plus timeout-wrapped server probes and real-phone manual smoke. Do not add Playwright unless the user explicitly approves the dependency.
- CI / GitHub Actions / Dockerfiles.
- Error UI, retry banners, exponential backoff, observability dashboards.
- README rewrites, CHANGELOG, additional `*.md` files.
- Refactors of working code.
- "Future improvements" sections in PLANS.md or comments. If it's not in SPEC.md, it's out of scope.

## Forbidden commands (require explicit user approval)

- `rm -rf`, `git restore`, `git reset --hard`, `git clean -fd`, `git push --force`
- `sudo`, anything outside the workspace
- Any network call beyond `pnpm install`, `pnpm create partykit@latest`, `pnpm dlx`, `npx partykit deploy`, `wget`/`curl` for the asset URLs in SPEC §10.2, and OpenAI API calls

## DO NOT RUN — these block forever

These commands stream and never exit. Codex's `exec` will hang waiting for EOF.

```
pnpm -F web dev          # streams the Vite dev server
pnpm -F party dev        # streams the PartyKit dev server
pnpm -F agent dev        # streams the agent
codex app-server         # streams JSON-RPC events
tail -f anything
docker compose up
```

**Use these patterns instead** for verification:

```bash
# build (one-shot, exits)
pnpm -F web build
pnpm -F party build  # if it has a build step; otherwise type-check only

# liveness probe with timeout
timeout 10 bash -c 'pnpm -F party dev & sleep 3 && curl -s http://127.0.0.1:1999/parties/main/test | head -c 200'

# smoke
pnpm -F web typecheck
pnpm -F party typecheck
pnpm -F agent typecheck
```

If you need to "see if the dev server starts" — wrap it in `timeout 10` and grep stdout for the URL line. Never `await` the dev server's exit.

## Loop check (mandatory)

If you read the same file twice in a row without an intervening edit, **STOP**. Write a "Stuck" entry to `PLANS.md` describing what you tried, what failed, and what you'd try next. End the turn. The user (or you on resume) will pick it up.

If `pnpm install` fails twice with the same error, **STOP**. Don't retry a third time — the error is real and needs a different action.

## Plan closure (mandatory before declaring done)

Before you finish ANY phase from SPEC §11 build sequence:

1. Reconcile every TODO, intention, or pending item in `PLANS.md` as Done / Blocked / Cancelled.
2. No `in_progress` items at end of turn.
3. No `TODO:` comments left in code.
4. No `throw new Error('not implemented')`.
5. No function bodies under 3 lines that aren't actually trivial (e.g. a single `return`).

## Done means (verification, not declaration)

You may not say "phase complete" until you have:

1. Run `pnpm -F <pkg> build` (or `typecheck`) and pasted the success line into `PLANS.md`.
2. For phases that involve a running server: run a `timeout 10 ... & curl` smoke test and paste the HTTP status + first 100 bytes of response into `PLANS.md`.
3. For phase 8 (deploy): paste the deployed URL into `PLANS.md` `Validation` section.

Anything else is "in progress."

## Budget (time-pressure rules)

Codex doesn't have a clock, so we encode time pressure as observable budgets:

- Maximum **3 attempts** at any single failing test/build before pivoting to a simpler approach. Document the trade-off in `PLANS.md`.
- Maximum **40 file edits** and **15 new files** per phase. If you exceed, stop and ask.
- Every **30 minutes of wall time** (use `date -u +%FT%TZ`), append a timestamped checkpoint to `PLANS.md` `Progress` describing what works end-to-end RIGHT NOW. If nothing works end-to-end, simplify until something does.
- If two consecutive phases have run over their hour budget by 50%+, switch to fallback paths (see SPEC §6.5 for the App Server fallback).

## Conditional fork (parallelism rule)

By default, build serially. **However**: if the hour-0 App Server or fallback-agent preflight is green (`PLANS.md` shows a working `say`/`move` tool call with trace captured), THEN you may optionally fork into parallel work via git worktrees:

```bash
git worktree add -b web-slice ../wheres-codex-web main
git worktree add -b party-slice ../wheres-codex-party main
git worktree add -b agent-slice ../wheres-codex-agent main
```

The user can then run three separate `codex exec` sessions, one per worktree, for hours 4–7. Merge back to main before deploy. **Only fork after the repo is initialized as git, the baseline commit exists, and the protocol is locked** — `packages/protocol/src/index.ts` must be final before parallelism, otherwise the three sessions will diverge on wire types.

If you (Codex) are running unattended, do not initiate fork yourself — the user decides.

## Codex App Server-specific rules

- Always set `cwd: '/tmp/wheres-codex-scratch'` on `thread/start` (create the dir first if missing).
- Always set `approvalPolicy: 'never'`.
- Always implement the **approval interceptor** in `Codex.onLine` (see SPEC §6.2) — it auto-declines all `*/requestApproval` and `mcpServer/elicitation/request` server requests. This is a known-issue mitigation; do not skip it.
- Always include the `systemAnchor` in every `turn/start` input (the "you are not coding" anchor — see SPEC §6.4).
- Subscribe to: `item/agentMessage/delta`, `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`, `turn/completed`. Opt out of: `turn/diff/updated`, `item/commandExecution/outputDelta`, `item/fileChange/*`, `thread/tokenUsage/updated`.
- JSON-RPC 2.0: every message you write to the App Server's stdin must include `jsonrpc: '2.0'`. Responses must echo the `id`. Notifications omit `id`.
- The `codex app-server generate-ts` subcommand mentioned in some references **may not exist** — do not depend on it. Hand-write App Server types from the README.

## OpenAI SDK shape (Responses API fallback)

The fallback uses `client.responses.create({ stream: true, ... })` returning an async iterable — NOT `client.responses.stream(...)` (which doesn't exist on the Node SDK).

```ts
import OpenAI from 'openai';
const client = new OpenAI();  // reads OPENAI_API_KEY from env
const stream = await client.responses.create({
  stream: true,
  model: process.env.CODEX_MODEL ?? 'gpt-5.3-codex',
  reasoning: { effort: 'low', summary: 'detailed' },
  tools: [/* function tool defs */],
  input: '...',
});
for await (const event of stream) { /* ... */ }
```

## PartyKit-specific rules

- Use `Server` (extends class with `onConnect`, `onMessage`, `onClose`) not the legacy `PartyKitServer` function shape.
- Read query-string role tags via `new URL(ctx.request.url).searchParams.get('as')` in `onConnect(conn, ctx)`.
- Tag connections via `conn.setState({ role })` — read with `conn.state` later.
- Broadcast: `this.room.broadcast(JSON.stringify(msg))` to all, or iterate `this.room.getConnections()` and filter by tag.
- iOS Safari kills WebSockets when the tab backgrounds — your client must listen to `visibilitychange` and reconnect.
- The dev server binds **IPv4 only** at `127.0.0.1:1999`. Use that, not `localhost`.

## Static Web Deploy Rules

- Use one Vite app shell for `/`, `/projector`, and `/admin`; branch in `web/src/main.ts` by `location.pathname`.
- Static hosts must rewrite all visible routes to `/index.html` (`vercel.json` is preseeded for this).
- QR/join URLs are built from `window.location.origin` plus `?room=...`; only WebSocket URLs use `VITE_PARTY_HOST`.
- Keep `web/src/net.ts` as the only place that constructs PartySocket clients.

## Mobile UX guardrails

- `100dvh`, never `100vh`.
- Chat input `font-size: 16px` (suppresses iOS auto-zoom).
- `padding-bottom: env(safe-area-inset-bottom)` on bottom-fixed UI.
- `visualViewport` API to handle keyboard pushup on iOS.
- All sprites: `image-rendering: pixelated;` per-element, not page-wide.
- Floor: single `repeat` background on body, not per-tile divs (15 sprites + 600 floor divs = paint storm).
- 30 fps `requestAnimationFrame`, not 60.

## Security boundaries

- `OPENAI_API_KEY`, `AGENT_SECRET`, `PROJECTOR_SECRET`, and `ADMIN_SECRET` live in `.env`. Never echo `.env` contents to stdout. Never commit `.env`. The committed file is `.env.example`.
- The party server validates `AGENT_SECRET` when an `agentPlayer` connects — do not skip this check (otherwise anyone could impersonate Codex and inject a fake trace).
- The party server validates `PROJECTOR_SECRET` for projector trace connections and `ADMIN_SECRET` for start/reset/fallback controls.
- Player chat is rate-limited server-side (1 msg / 800 ms, 20 msgs / 30 s). Do not skip rate limits even in dev.
- Render chat, trace, replay, and error strings using DOM text nodes / `textContent`, never `innerHTML`.

## When stuck

If a problem persists after 3 attempts AND following the loop-check pattern:

1. Don't keep retrying.
2. Open `PLANS.md`.
3. Add a `## Stuck — <timestamp>` section describing: what you tried, what failed, what you suspect, what you'd try next.
4. End the turn.

When the user resumes (`codex resume --last "..."`), they will see your block and either course-correct or pivot you.

## Mistake → memory

When you make the same mistake twice (e.g. typoing the same import path, retrying the same hallucinated command), append a one-liner to the bottom of this file under `## Lessons` so future-you doesn't repeat. Yes, this is the one place you may edit AGENTS.md — only the `## Lessons` section, only append.

---

## Lessons

(empty — append as you learn)
