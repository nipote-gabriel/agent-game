# Agent Game

A small multiplayer party game for exactly 3 players.

- One player creates a lobby and shares the 4-letter code; the others join with it (max 3 per lobby).
- Everyone picks an avatar. The host (★) sets how many rounds to play.
- The host can start once exactly 3 players are in.
- At the start of each game, one random player becomes the **Agent** and stays the Agent for every round
  of that game. Each round, the other two get the same vague word or concept (e.g. "Tree-like", "Momentum").
- **Next round** is a vote: when 2 of the 3 players have pressed it, everyone moves to the next round
  with a new word. Tap it again to take your vote back.
- After the last round, everyone votes for who they think the Agent is (you can't pick yourself, and you
  can change your pick until all three have voted):
  - both Citizens pick the Agent → **Citizens win**
  - two votes land on the same non-Agent → **the Agent wins**
  - one vote each (1, 1, 1) → **Stalemate**
- The result screen reveals the Agent, everyone's votes and every round's word, with **New Game** (back to the lobby with the
  same players) and **Home**.

## Deploy on Vercel

1. In your Vercel project, connect this GitHub repo (Settings → Git), or import it as a new project.
   Framework preset: **Other**. No build command needed (`vercel.json` serves `public/`).
2. Add Redis: in the project, open **Storage** (or the Marketplace), add **Upstash for Redis** (free tier is fine)
   and connect it to the project. That sets the `KV_REST_API_URL` / `KV_REST_API_TOKEN`
   (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) environment variables.
3. Redeploy so the functions pick up the new variables.
4. Check `https://<your-domain>/api/health`. It should show `"ok": true` and `"storage": "redis"`.
   It lists the Redis env var names it found (never their values) and the deployed commit.

## Run locally

```bash
npm install
npm run local
# open http://localhost:3000 in three browser tabs
```

Without the Redis env vars, lobbies are stored in memory. That's fine for local testing.

## How it works

- `api/action.js`: every change (create, join, avatar, rounds, start, vote, accuse, new game, leave).
- `api/state.js`: each browser polls this about once a second (one Redis read), and pings every 5s
  to say it's still there. That's about 1.4 Redis commands per player per second. Players who stop pinging are removed
  (after 30s in the lobby, or 5 min during a game, so locking your phone briefly doesn't end it).
- `lib/game.js`: game rules. `lib/words.js`: the word list. `lib/store.js`: Redis or in-memory storage.
- `public/`: plain HTML/CSS/JS frontend, no build step.
- Reloading the page puts you back in your lobby.
