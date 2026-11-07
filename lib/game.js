const crypto = require("crypto");
const ADJECTIVES = require("./words");

const MAX_PLAYERS = 3;
const AVATARS = ["🦊", "🐙", "🦉", "🐸", "🐼", "🦁", "🐢", "🦄", "🐧", "🤖", "👽", "🐲"];
// A player who stops checking in is removed after this long.
// It's longer during a game so locking your phone for a bit doesn't end it.
const STALE_LOBBY_MS = 30 * 1000;
const STALE_GAME_MS = 5 * 60 * 1000;

class GameError extends Error {}
const fail = (msg) => {
  throw new GameError(msg);
};

function pick(arr, exclude) {
  const options = arr.filter((x) => x !== exclude);
  return options[Math.floor(Math.random() * options.length)];
}

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join("");
}

const cleanName = (name) => String(name || "").trim().slice(0, 20) || "Player";

function newLobby(code) {
  return { code, hostId: null, rounds: 5, players: [], game: null, notice: null };
}

// Adds a player and returns their secret token.
function addPlayer(lobby, { name, avatar }) {
  if (lobby.players.length >= MAX_PLAYERS) fail("That lobby is full.");
  if (lobby.game) fail("That game has already started.");
  const taken = lobby.players.map((p) => p.avatar);
  if (!AVATARS.includes(avatar) || taken.includes(avatar)) avatar = AVATARS.find((a) => !taken.includes(a));
  const player = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: cleanName(name), avatar };
  lobby.players.push(player);
  if (!lobby.hostId) lobby.hostId = player.id;
  return player.token;
}

function setNotice(lobby, text) {
  lobby.notice = { id: crypto.randomUUID(), text };
}

// Removes players. Returns false if the lobby is now empty.
function removePlayers(lobby, tokens, reason) {
  const before = lobby.players.length;
  lobby.players = lobby.players.filter((p) => !tokens.includes(p.token));
  if (lobby.players.length === before) return true;
  if (lobby.players.length === 0) return false;
  if (!lobby.players.some((p) => p.id === lobby.hostId)) lobby.hostId = lobby.players[0].id;
  if (lobby.game) {
    lobby.game = null;
    setNotice(lobby, reason || "A player left, so the game ended.");
  }
  return true;
}

function startRound(lobby) {
  const g = lobby.game;
  g.agentId = pick(lobby.players.map((p) => p.id), g.agentId);
  g.word = pick(ADJECTIVES, g.word);
  g.wordVersion = 0;
}

// Applies an in-lobby action by the player `me`.
function applyAction(lobby, me, body) {
  const isHost = me.id === lobby.hostId;
  switch (body.action) {
    case "setAvatar": {
      if (lobby.game || !AVATARS.includes(body.avatar)) return;
      if (lobby.players.some((p) => p.avatar === body.avatar && p.id !== me.id)) fail("Avatar already taken.");
      me.avatar = body.avatar;
      return;
    }
    case "setRounds": {
      if (lobby.game || !isHost) return;
      lobby.rounds = Math.max(1, Math.min(50, parseInt(body.rounds, 10) || 1));
      return;
    }
    case "start": {
      if (lobby.game) return;
      if (!isHost) fail("Only the host can start the game.");
      if (lobby.players.length !== MAX_PLAYERS) fail(`You need exactly ${MAX_PLAYERS} players to start.`);
      lobby.game = { round: 1, totalRounds: lobby.rounds, agentId: null, word: null, wordVersion: 0 };
      startRound(lobby);
      return;
    }
    case "refresh": {
      // New adjective for the two non-agents; the agent stays the same.
      if (!lobby.game) return;
      lobby.game.word = pick(ADJECTIVES, lobby.game.word);
      lobby.game.wordVersion++;
      return;
    }
    case "nextRound": {
      if (!lobby.game) return;
      if (body.round !== undefined && body.round !== lobby.game.round) return; // double-click guard
      if (lobby.game.round >= lobby.game.totalRounds) {
        lobby.game = null;
        setNotice(lobby, "Game over! Back to the lobby.");
      } else {
        lobby.game.round++;
        startRound(lobby);
      }
      return;
    }
    case "endGame": {
      if (lobby.game && isHost) lobby.game = null;
      return;
    }
    default:
      fail("Unknown action.");
  }
}

// What one player is allowed to see.
function viewFor(lobby, token) {
  const me = lobby.players.find((p) => p.token === token);
  let card = null;
  if (lobby.game) {
    card = me.id === lobby.game.agentId ? { type: "agent", text: "Agent" } : { type: "word", text: lobby.game.word };
  }
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    rounds: lobby.rounds,
    players: lobby.players.map(({ id, name, avatar }) => ({ id, name, avatar })),
    avatars: AVATARS,
    maxPlayers: MAX_PLAYERS,
    notice: lobby.notice,
    game: lobby.game
      ? { round: lobby.game.round, totalRounds: lobby.game.totalRounds, wordVersion: lobby.game.wordVersion }
      : null,
    you: me.id,
    card,
  };
}

module.exports = {
  GameError,
  fail,
  makeCode,
  newLobby,
  addPlayer,
  removePlayers,
  applyAction,
  viewFor,
  staleMs: (lobby) => (lobby.game ? STALE_GAME_MS : STALE_LOBBY_MS),
};
