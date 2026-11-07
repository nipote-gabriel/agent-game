const crypto = require("crypto");
const ADJECTIVES = require("./words");

const MAX_PLAYERS = 3;
const VOTES_TO_ADVANCE = 2; // players who must press "Next round" to move on
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
  if (lobby.game && !lobby.game.finished) fail("That game has already started.");
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
  if (lobby.game && !lobby.game.finished) {
    lobby.game = null;
    setNotice(lobby, reason || "A player left, so the game ended.");
  }
  if (lobby.game) lobby.game.votes = lobby.game.votes.filter((id) => lobby.players.some((p) => p.id === id));
  return true;
}

// New round: a new word. The Agent is picked at random once per game and
// stays the same for every round of that game.
function startRound(lobby) {
  const g = lobby.game;
  if (!g.agentId) {
    const ids = lobby.players.map((p) => p.id);
    g.agentId = ids[crypto.randomInt(ids.length)];
  }
  g.word = pick(ADJECTIVES, g.word);
  g.votes = [];
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
      lobby.game = { round: 1, totalRounds: lobby.rounds, agentId: null, word: null, votes: [], finished: false };
      startRound(lobby);
      return;
    }
    case "vote": {
      // Toggle your vote for the next round. Enough votes moves everyone on.
      const g = lobby.game;
      if (!g || g.finished) return;
      if (body.round !== g.round) return; // vote was for a round that already ended
      g.votes = body.on ? [...new Set([...g.votes, me.id])] : g.votes.filter((id) => id !== me.id);
      if (g.votes.length < VOTES_TO_ADVANCE) return;
      if (g.round >= g.totalRounds) {
        g.finished = true;
        g.votes = [];
      } else {
        g.round++;
        startRound(lobby);
      }
      return;
    }
    case "newGame": {
      // From the game-over screen: everyone goes back to the lobby to set up again.
      if (lobby.game?.finished) lobby.game = null;
      return;
    }
    case "endGame": {
      if (lobby.game && !lobby.game.finished && isHost) lobby.game = null;
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
  if (lobby.game && !lobby.game.finished) {
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
      ? {
          round: lobby.game.round,
          totalRounds: lobby.game.totalRounds,
          votes: lobby.game.votes,
          votesNeeded: VOTES_TO_ADVANCE,
          finished: lobby.game.finished,
        }
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
