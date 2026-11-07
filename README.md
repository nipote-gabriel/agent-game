# Agent Game

A small multiplayer party game for exactly 3 players.

- One player creates a lobby and shares the 4-letter code; the others join with it (max 3 per lobby).
- Everyone picks an avatar. The host (★) sets how many rounds to play.
- The host can start once exactly 3 players are in.
- Each round, one random player gets an **Agent** card. The other two get the same adjective (e.g. "Purple").
- **Refresh words** gives the two non-agents a new adjective. The Agent stays the same for the whole round.
- **Next round** picks a new Agent and a new word. After the last round, everyone goes back to the lobby.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000 in three browser tabs
```

## Customizing

- Word list: `words.js`
- Avatars: `AVATARS` in `server.js`
- Server logic: `server.js` (Express + Socket.IO, all state in memory)
- Frontend: `public/` (plain HTML/CSS/JS, no build step)

## Deploying

This needs a host that runs a Node server with WebSockets (e.g. Render, Railway, Fly.io).
Static-only hosts like GitHub Pages won't work. Use `npm start` as the start command. The server reads `PORT` from the environment.
