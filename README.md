# where's codex

a multiplayer 2d office lobby. 8–15 players join from their phones. nobody has a name — only a numbered pixel-art sprite. one player is codex.

wrong votes eliminate. first correct vote wins.

```
play:    https://wheres-codex.<jeremy>.vercel.app/?room=SGN-DEMO
qr:      generated on /projector from the web URL
trace:   https://wheres-codex.<jeremy>.vercel.app/projector?room=SGN-DEMO
ws:      https://wheres-codex.<jeremy>.partykit.dev
```

## what it is

a turing-test party game. you and your friends walk pixel sprites around an office floor. someone in there is codex, pretending to be a hackathon attendee. you have 3 minutes 30 to spot it.

vote `[07]` and you're right? you win. wrong? you're a ghost — watch the rest of the round play out. nobody catches it before the timer? codex walks away and the projector shows you exactly how it pulled it off.

## how it works

- **codex app server** is the codex agent harness exposed as a JSON-RPC stream. we feed it custom tools — `say(message)`, `move(landmark)`, `idle()` — instead of its usual coding tools. `CODEX_MODEL` selects the available Codex model. its reasoning is the entire reveal.
- **partykit** holds the room state. one durable object per room, authoritative for positions, chat, votes, and AI identity (which is never broadcast until reveal).
- **the agent bridge** runs on a laptop in the room. it joins as a regular numbered player, ticks every few seconds, asks a cheap cadence gate "should i reply right now?", and only fires codex when the answer is yes. you can see the laptop. you can point at it.

the codex primitive on display: **app server's reasoning stream as a public surface**. without it, this is "we used gpt to roleplay an npc." with it, you see the actual `item/agentMessage/delta` events as the round plays, in real time, on the projector. that's the demo.

## how to run

```bash
pnpm install
export OPENAI_API_KEY=sk-...

# three terminals
pnpm -F party dev
pnpm -F web dev
pnpm -F agent dev
```

open `http://127.0.0.1:5173/?room=local` on a couple of phones (same wifi). open `http://127.0.0.1:5173/projector?room=local&secret=$PROJECTOR_SECRET` on a laptop pointed at the wall.

## how it was built

codex built it. dkundel put codex into doom; we put codex into a party game. the build spec lives at [`SPEC.md`](./SPEC.md), the operational guide for the agent at [`AGENTS.md`](./AGENTS.md), and the running progress log at [`PLANS.md`](./PLANS.md).

## credits

- characters: [16x16 base sprites](https://opengameart.org/content/16x16-base-sprites) (cc0)
- furniture: [kenney roguelike indoors](https://kenney.nl/assets/roguelike-indoors) (cc0)
- font: [press start 2p](https://fonts.google.com/specimen/Press+Start+2P) (sil ofl)
- everything else: codex.

shipped at the openai codex hackathon, sydney, 2026-04-29.

## license

mit.
