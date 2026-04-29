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

- [x] **H0 (0:00 – 0:30)** — App Server spike + scaffold. Prove `codex app-server` dynamicTools/trace or choose Responses fallback, then scaffold pnpm workspace.
  - Validation: console shows one traceable event + a `say` or `move` tool call, OR `AgentDriver=responses` fallback is selected and recorded.
- [x] **H1 (0:30 – 1:30)** — PartyKit `Lobby` server: protocol locked, `agentPlayer`, `agentTrace`, admin/projector secrets, reconnect session, roster, position, chat, trace buffer.
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

### t+00:00 — 2026-04-29T03:53:50Z — H0 started

Read AGENTS.md, SPEC.md, and PLANS.md. Workspace currently has only root config/docs; no `web/`, `party/`, `agent/`, or `packages/protocol` implementation yet. Starting with the required App Server preflight before scaffold/polish.

### t+00:08 — 2026-04-29T04:02:17Z — App Server preflight green

Codex App Server preflight is green with `gpt-5.3-codex`: `initialize`, `model/list`, `thread/start` with `/tmp/wheres-codex-scratch`, `approvalPolicy: never`, dynamic `say`/`move`/`idle`, approval interceptor, one `turn/start`, traceable notifications, and a `say` tool call. No built-in shell/file/web tool was attempted.

### t+00:20 — 2026-04-29T04:14:55Z — Workspace scaffolded

Created workspace packages for `packages/protocol`, `party`, `web`, and `agent`; locked the first protocol shape in `packages/protocol/src/index.ts`; installed allowlisted dependencies with pnpm after transient registry failures.

### t+00:31 — 2026-04-29T04:25:41Z — Party server backbone running

Implemented PartyKit room state for numbered reconnecting players, authenticated agent/projector/admin roles, hidden AI slot, movement, chat rate limits, trace buffer, admin controls, and vote/ghost/reveal transitions. Local bounded PartyKit HTTP probe returns `HTTP 200` on `127.0.0.1:1999`.

### t+00:51 — 2026-04-29T04:45:15Z — Web shell and agent bridge compile

Implemented a single Vite app for player/projector/admin routes with QR, office map, numbered sprites, tap movement, chat, vote grid, trace pane, and reveal overlay. Implemented App Server agent bridge with approval interceptor, trace normalization, PartyKit agentPlayer connection, cadence heuristic, and dynamic tool handling. PartyKit WebSocket smoke confirms fake players, fake agent trace, admin start/reset, movement, and chat.

### t+00:52 — 2026-04-29T04:46:30Z — Parallel coordination started

User confirmed they want a singular coordination thread using worktrees/subagents. Main thread remains coordinator and critical-path integrator; current checkpoint will be committed so worktrees inherit the same protocol/server/web/agent baseline. First known integration blocker: local e2e timed out waiting for real agent readiness because the PartyKit smoke used env loading that left protected agent/projector/admin role secrets mismatched or blank in dev, causing `agentReady`/`agentTrace` to be rejected.

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

### H0 App Server preflight — 2026-04-29T04:02:17Z

`source ~/.nvm/nvm.sh && nvm use && export PATH="$NVM_BIN:$PATH" && node --version && pnpm --version`
```
Found '/Users/jrmyyee/Documents/Projects/codex_hack/.nvmrc' with version <22.15.0>
Now using node v22.15.0 (npm v11.6.2)
v22.15.0
9.12.0
```

`codex app-server generate-json-schema --experimental --out /tmp/wheres-codex-appserver-schema`
```
WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)
```

`codex app-server generate-ts --experimental --out /tmp/wheres-codex-appserver-ts`
```
WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)
```

`source ~/.nvm/nvm.sh && nvm use && export PATH="$NVM_BIN:$PATH" && node /tmp/wheres-codex-appserver-preflight.mjs`
```
{
  "ok": false,
  "reason": "thread/start: error creating thread: Fatal error: Codex cannot access session files at /Users/jrmyyee/.codex/sessions (permission denied). If sessions were created using sudo, fix ownership: sudo chown -R $(whoami) /Users/jrmyyee/.codex (underlying error: Operation not permitted (os error 1))",
  "selectedModel": "gpt-5.3-codex",
  "threadId": null,
  "tool": null,
  "trace": [],
  "stderr": [
    "WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error",
    "1)",
    "2026-04-29T04:01:58.729827Z ERROR codex_core::session: Failed to create session: Operation not permitted (os error 1)"
  ]
}
```

`/Users/jrmyyee/.nvm/versions/node/v22.15.0/bin/node /tmp/wheres-codex-appserver-preflight.mjs` (approved escalation for normal App Server session storage + OpenAI API/App Server calls)
```
{
  "ok": true,
  "reason": "green",
  "selectedModel": "gpt-5.3-codex",
  "threadId": "019dd767-f564-7ec3-bd9c-3fad0a53908b",
  "tool": {
    "tool": "say",
    "namespace": null,
    "arguments": {
      "message": "yeah just lagging a bit"
    }
  },
  "trace": [
    {
      "method": "item/started",
      "sample": "userMessage"
    },
    {
      "method": "item/started",
      "sample": "reasoning"
    },
    {
      "method": "item/started",
      "sample": "dynamicToolCall"
    },
    {
      "method": "item/started",
      "sample": "agentMessage"
    },
    {
      "method": "turn/completed",
      "sample": "completed"
    }
  ],
  "stderr": []
}
```

### H0 scaffold/install — 2026-04-29T04:14:55Z

`source ~/.nvm/nvm.sh && nvm use && export PATH="$NVM_BIN:$PATH" && pnpm install`
```
WARN GET https://registry.npmjs.org/typescript error (ENOTFOUND). Will retry...
ERR_PNPM_META_FETCH_FAIL GET https://registry.npmjs.org/typescript: request to https://registry.npmjs.org/typescript failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
```

`/Users/jrmyyee/.nvm/versions/node/v22.15.0/bin/pnpm install` (approved registry access)
```
ECONNRESET request to https://registry.npmjs.org/partykit/-/partykit-0.0.114.tgz failed, reason: socket hang up
```

`/Users/jrmyyee/.nvm/versions/node/v22.15.0/bin/pnpm install`
```
Packages: +124
devDependencies:
+ @types/node 22.19.17 (25.6.0 is available)
+ tsx 4.21.0
+ typescript 5.9.3 (6.0.3 is available)
WARN Issues with peer dependencies found
party
└─┬ partyserver 0.0.76
  └── ✕ unmet peer @cloudflare/workers-types@^4.20240729.0: found 4.20240718.0
Done in 1m 0.5s
```

### H1 Party server — 2026-04-29T04:25:41Z

`source ~/.nvm/nvm.sh && nvm use && export PATH="$NVM_BIN:$PATH" && pnpm -F party typecheck`
```
Found '/Users/jrmyyee/Documents/Projects/codex_hack/.nvmrc' with version <22.15.0>
Now using node v22.15.0 (npm v11.6.2)

> party@0.1.0 typecheck /Users/jrmyyee/Documents/Projects/codex_hack/party
> tsc --noEmit
```

`source ~/.nvm/nvm.sh && nvm use && export PATH="$NVM_BIN:$PATH" && pnpm -F @wheres-codex/protocol typecheck`
```
Found '/Users/jrmyyee/Documents/Projects/codex_hack/.nvmrc' with version <22.15.0>
Now using node v22.15.0 (npm v11.6.2)

> @wheres-codex/protocol@0.1.0 typecheck /Users/jrmyyee/Documents/Projects/codex_hack/packages/protocol
> tsc --noEmit
```

`bash /tmp/wheres-codex-party-smoke.sh` (approved escalation for local port bind)
```
HTTP 200
wheres-codex SGN-SMOKE lobby players=0
{
  "chatSeen": true,
  "posSeen": true,
  "traceSeen": true,
  "phaseSeen": true,
  "resetSeen": true,
  "eventCount": 59
}
--- dev log ---
🎈 PartyKit v0.0.114
Build succeeded, starting server...
[pk:inf] Ready on http://0.0.0.0:1999
[pk:inf] - http://127.0.0.1:1999
[pk:inf] GET /parties/main/SGN-SMOKE 200 OK (3ms)
[pk:inf] GET /parties/main/SGN-SMOKE 101 Switching Protocols
```

`ps -o pid,ppid,command -ax | rg 'partykit dev --port 1999|wheres-codex-party-smoke|wheres-codex-party-ws-smoke'`
```
Only the `ps`/`rg` verification commands were listed; no PartyKit smoke/dev process remained.
```

### H2/H4 compile checks — 2026-04-29T04:45:15Z

`source ~/.nvm/nvm.sh && nvm use && export PATH="$NVM_BIN:$PATH" && pnpm -F web typecheck`
```
Found '/Users/jrmyyee/Documents/Projects/codex_hack/.nvmrc' with version <22.15.0>
Now using node v22.15.0 (npm v11.6.2)

> web@0.1.0 typecheck /Users/jrmyyee/Documents/Projects/codex_hack/web
> tsc --noEmit
```

`source ~/.nvm/nvm.sh && nvm use && export PATH="$NVM_BIN:$PATH" && pnpm -F web build`
```
vite v6.4.2 building for production...
✓ 61 modules transformed.
dist/index.html                  0.71 kB │ gzip:  0.38 kB
dist/assets/index-DRntfMFH.css   7.29 kB │ gzip:  2.48 kB
dist/assets/index-CpcSGaOi.js   49.63 kB │ gzip: 18.28 kB
✓ built in 151ms
```

`source ~/.nvm/nvm.sh && nvm use && export PATH="$NVM_BIN:$PATH" && pnpm -F agent typecheck`
```
Found '/Users/jrmyyee/Documents/Projects/codex_hack/.nvmrc' with version <22.15.0>
Now using node v22.15.0 (npm v11.6.2)

> agent@0.1.0 typecheck /Users/jrmyyee/Documents/Projects/codex_hack/agent
> tsc --noEmit
```

### Local e2e attempt — 2026-04-29T04:37:14Z

`bash /tmp/wheres-codex-local-e2e.sh` (approved local PartyKit + real agent smoke; sourced `.env` without printing it)
```
Error: timeout waiting for agent ready
--- party log ---
Loading environment variables from ../.env
Build succeeded, starting server...
[pk:inf] Ready on http://0.0.0.0:1999
[pk:inf] GET /parties/main/SGN-E2E 101 Switching Protocols
TypeError: Can't call WebSocket send() after close().
  at Lobby.send
  at Lobby.sendError
  at Lobby.handleAgentReady
...
--- agent log ---
> agent@0.1.0 dev /Users/jrmyyee/Documents/Projects/codex_hack/agent
> tsx src/index.ts
2026-04-29T04:37:14.058029Z ERROR rmcp::transport::worker: worker quit with fatal: Client error: HTTP request failed: http/request failed: error sending request for url (https://chatgpt.com/backend-api/wham/apps), when send initialized notification
```

Interpretation: fake-agent WS smoke passed; real-agent e2e currently blocked on dev env/role handling and possibly App Server notification network/auth behavior. Coordinator/main thread owns this blocker unless delegated after worktree split.

---

## Surprises & Discoveries

(When SPEC.md is wrong about a detail, or a library has changed shape since the spec was written, or a setting that was supposed to work doesn't — record it here with: what you expected, what happened, what you did instead.)

- 2026-04-29T03:53:50Z — Local shell Node is `v25.2.1`, newer than pinned `.nvmrc` target `22.15.0`; will try `nvm use` before dependency install/build, and continue only if checks pass.
- 2026-04-29T04:02:17Z — App Server `generate-ts` exists in local Codex CLI despite SPEC warning that it may not. Used it only for preflight protocol discovery, not as a build dependency.
- 2026-04-29T04:02:17Z — Sandboxed App Server preflight cannot write `~/.codex/sessions`; approved rerun worked. The actual demo agent may need to run outside the repo sandbox or with equivalent permissions.
- 2026-04-29T04:14:55Z — `pnpm install` hit sandbox DNS failure first, then an approved transient `partykit` tarball `ECONNRESET`; a final cache-reusing pnpm attempt succeeded.
- 2026-04-29T04:14:55Z — pnpm resolved TypeScript to `5.9.3` via the allowed `^5.6` range. Keeping it because package constraints allow it and no build has failed.
- 2026-04-29T04:14:55Z — `partyserver@0.0.76` reports an unmet peer range for `@cloudflare/workers-types`; not adding that package because it is outside the dependency allowlist unless a build failure forces a decision.
- 2026-04-29T04:25:41Z — `partyserver@0.0.76` typechecks but PartyKit dev cannot start it here: Miniflare reports `No such module "src/partykit-exposed-cloudflare-workers"` from the `cloudflare:workers` import. Switched the room entry to PartyKit's installed class API (`implements Party.Server`) for runtime compatibility while retaining the same wire protocol and role/state behavior.
- 2026-04-29T04:25:41Z — PartyKit CLI `dev --host` is not supported in `partykit@0.0.114`; changed dev script to `partykit dev --port 1999`. It advertises `127.0.0.1:1999` after start.

---

## Decisions

(When you make a choice not explicit in SPEC.md, record it here. One line: `<decision> — <reason>`.)

- Saigon Rush implementation is a read-only reference — it already solved role routes, QR/lobby flow, session WebSocket wrappers, buffer caps, and static-web/backend deploy split for a real hackathon game.
- App Server driver stays primary for the build — H0 produced a real dynamic `say` tool call and traceable App Server notifications with `gpt-5.3-codex`.

---

## Stuck

(If you hit a wall and can't proceed after 3 attempts, write a `### Stuck — <timestamp>` block describing: what you tried, what failed, what you suspect, what you'd try next. Then end the turn.)

---

## Final report

(At end of build, summarize what shipped, what didn't, what's known-broken, and the public URL.)
