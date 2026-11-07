# Agent Game

A small multiplayer party game for exactly 3 players.

- One player creates a lobby and shares the 4-letter code; the others join with it (max 3 per lobby).
- Everyone picks an avatar. The host (★) sets how many rounds to play.
- The host can start once exactly 3 players are in.
- Each round, one random player gets an **Agent** card. The other two get the same adjective (e.g. "Purple").
- **Refresh words** gives the two non-agents a new adjective. The Agent stays the same for the whole round.
- **Next round** picks a new Agent and a new word. After the last round, everyone goes back to the lobby.

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

- `api/action.js`: every change (create, join, avatar, rounds, start, refresh, next round, leave).
- `api/state.js`: each browser polls this about once a second (one Redis read), and pings every 5s
  to say it's still there. That's about 1.4 Redis commands per player per second. Players who stop pinging are removed
  (after 30s in the lobby, or 5 min during a game, so locking your phone briefly doesn't end it).
- `lib/game.js`: game rules. `lib/words.js`: the adjective list. `lib/store.js`: Redis or in-memory storage.
- `public/`: plain HTML/CSS/JS frontend, no build step.
- Reloading the page puts you back in your lobby.
