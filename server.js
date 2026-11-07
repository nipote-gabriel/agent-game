const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const ADJECTIVES = require("./words");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 3;
const AVATARS = ["🦊", "🐙", "🦉", "🐸", "🐼", "🦁", "🐢", "🦄", "🐧", "🤖", "👽", "🐲"];

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server);

/** code -> lobby */
const lobbies = new Map();

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (lobbies.has(code));
  return code;
}

function pick(arr, exclude) {
  const options = arr.filter((x) => x !== exclude);
  return options[Math.floor(Math.random() * options.length)];
}

function publicState(lobby) {
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    rounds: lobby.rounds,
    players: lobby.players.map(({ id, name, avatar }) => ({ id, name, avatar })),
    avatars: AVATARS,
    maxPlayers: MAX_PLAYERS,
    game: lobby.game
      ? { round: lobby.game.round, totalRounds: lobby.game.totalRounds, wordVersion: lobby.game.wordVersion }
      : null,
  };
}

// Send everyone the lobby state, plus each player's own private card.
function broadcast(lobby) {
  const state = publicState(lobby);
  for (const p of lobby.players) {
    let card = null;
    if (lobby.game) {
      card = p.id === lobby.game.agentId ? { type: "agent", text: "Agent" } : { type: "word", text: lobby.game.word };
    }
    io.to(p.id).emit("state", { ...state, you: p.id, card });
  }
}

function startRound(lobby) {
  const g = lobby.game;
  g.agentId = pick(lobby.players.map((p) => p.id), g.agentId);
  g.word = pick(ADJECTIVES, g.word);
  g.wordVersion = 0;
}

function leave(socket) {
  const code = socket.data.code;
  const lobby = code && lobbies.get(code);
  if (!lobby) return;
  socket.leave(code);
  socket.data.code = null;
  lobby.players = lobby.players.filter((p) => p.id !== socket.id);
  if (lobby.players.length === 0) {
    lobbies.delete(code);
    return;
  }
  if (lobby.hostId === socket.id) lobby.hostId = lobby.players[0].id;
  if (lobby.game) {
    lobby.game = null; // someone left mid-game: back to the lobby
    io.to(code).emit("notice", "A player left, so the game ended.");
  }
  broadcast(lobby);
}

function cleanName(name) {
  return String(name || "").trim().slice(0, 20) || "Player";
}

io.on("connection", (socket) => {
  const err = (msg) => socket.emit("errorMsg", msg);

  function join(lobby, { name, avatar }) {
    if (lobby.players.length >= MAX_PLAYERS) return err("That lobby is full.");
    if (lobby.game) return err("That game has already started.");
    const taken = lobby.players.map((p) => p.avatar);
    if (!AVATARS.includes(avatar) || taken.includes(avatar)) avatar = AVATARS.find((a) => !taken.includes(a));
    lobby.players.push({ id: socket.id, name: cleanName(name), avatar });
    socket.join(lobby.code);
    socket.data.code = lobby.code;
    broadcast(lobby);
  }

  socket.on("create", (info) => {
    leave(socket);
    const code = makeCode();
    const lobby = { code, hostId: socket.id, rounds: 5, players: [], game: null };
    lobbies.set(code, lobby);
    join(lobby, info || {});
  });

  socket.on("join", (info) => {
    const lobby = lobbies.get(String(info?.code || "").trim().toUpperCase());
    if (!lobby) return err("No lobby with that code.");
    if (lobby.code === socket.data.code) return;
    leave(socket);
    join(lobby, info);
  });

  const current = () => lobbies.get(socket.data.code);

  socket.on("setAvatar", (avatar) => {
    const lobby = current();
    if (!lobby || lobby.game || !AVATARS.includes(avatar)) return;
    if (lobby.players.some((p) => p.avatar === avatar && p.id !== socket.id)) return err("Avatar already taken.");
    lobby.players.find((p) => p.id === socket.id).avatar = avatar;
    broadcast(lobby);
  });

  socket.on("setRounds", (n) => {
    const lobby = current();
    if (!lobby || lobby.game || lobby.hostId !== socket.id) return;
    lobby.rounds = Math.max(1, Math.min(50, parseInt(n, 10) || 1));
    broadcast(lobby);
  });

  socket.on("start", () => {
    const lobby = current();
    if (!lobby || lobby.game) return;
    if (lobby.hostId !== socket.id) return err("Only the host can start the game.");
    if (lobby.players.length !== MAX_PLAYERS) return err(`You need exactly ${MAX_PLAYERS} players to start.`);
    lobby.game = { round: 1, totalRounds: lobby.rounds, agentId: null, word: null, wordVersion: 0 };
    startRound(lobby);
    broadcast(lobby);
  });

  // New adjective for the two non-agents. The agent stays the same.
  socket.on("refresh", () => {
    const lobby = current();
    if (!lobby?.game) return;
    lobby.game.word = pick(ADJECTIVES, lobby.game.word);
    lobby.game.wordVersion++;
    broadcast(lobby);
  });

  socket.on("nextRound", () => {
    const lobby = current();
    if (!lobby?.game) return;
    if (lobby.game.round >= lobby.game.totalRounds) {
      lobby.game = null;
      io.to(lobby.code).emit("notice", "Game over! Back to the lobby.");
    } else {
      lobby.game.round++;
      startRound(lobby);
    }
    broadcast(lobby);
  });

  socket.on("endGame", () => {
    const lobby = current();
    if (!lobby?.game || lobby.hostId !== socket.id) return;
    lobby.game = null;
    broadcast(lobby);
  });

  socket.on("leave", () => {
    leave(socket);
    socket.emit("left");
  });
  socket.on("disconnect", () => leave(socket));
});

server.listen(PORT, () => console.log(`Agent Game running on http://localhost:${PORT}`));
