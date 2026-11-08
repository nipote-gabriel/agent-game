# Agent Game

A small multiplayer party game for exactly 3 players.

- One player creates a lobby and shares the 4-letter code; the others join with it (max 3 per lobby).
- Everyone picks an avatar. The host sets how many rounds to play.
- The host can start once exactly 3 players are in.
- At the start of each game, one random player becomes the **Agent** (for the whole game) and a secret
  **phrase** of at least 16 letters is picked (e.g. "Barking up the wrong tree"). The two **Citizens** see the
  whole phrase; the Agent only sees blanks. The Agent starts with the first letter of the first word plus a one-word
  synonym as a hint (e.g. "Taboo"), and gets one more random letter every round, Wheel of Fortune style: every copy of a revealed letter shows up.
- Each round has a **Judge**, highlighted in gold on the name tags. It rotates around the table each round,
  starting from a random player.
- Round 1 opens straight on the cards. Every later round starts on a **Choose your people** screen with
  no cards showing: everyone names a public figure out loud. When 2 of the 3 players tap
  **Generate Words**, the cards appear.
- **Next round** needs all 3 players to press it before everyone moves to the next round.
  The last round (the host's round count) can't be skipped.
- **Lock-ins:** at any time, tap a name tag to lock in who you think the Agent is (tap again to unlock).
  Everyone has this, so the Agent's screen looks the same, and nobody can see anyone else's lock.
  The game is decided the moment:
  - both Citizens are locked in on the Agent → **Citizens win**
  - both Citizens are locked in on different players → **the Agent wins**
  - the Agent and a Citizen are locked in on the same player → **the Agent wins**
- **The Agent's guess:** once per round the Agent can type a guess at the phrase. Right → **the Agent wins**
  (if the Citizens haven't already caught them).
- The result screen shows who won and why, the Agent, the phrase, both Citizens' lock-ins and the Agent's
  wrong guesses, with **New Game** (back to the lobby with the same players) and **Home**.

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

- `api/action.js`: every change (create, join, avatar, rounds, start, reveal, vote, lock, guess, new game, leave).
- `api/state.js`: each browser polls this about once a second (one Redis read), and pings every 5s
  to say it's still there. That's about 1.4 Redis commands per player per second. Players who stop pinging are removed
  (after 30s in the lobby, or 5 min during a game, so locking your phone briefly doesn't end it).
- `lib/game.js`: game rules. `lib/words.js`: the phrase list. `lib/store.js`: Redis or in-memory storage.
- `public/`: plain HTML/CSS/JS frontend, no build step.
- Reloading the page puts you back in your lobby.
