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
  if (lobby.game && lobby.game.phase !== "result") fail("That game has already started.");
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
  if (lobby.game && lobby.game.phase !== "result") {
    lobby.game = null;
    setNotice(lobby, reason || "A player left, so the game ended.");
  }
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

// With no self-votes, every combination falls into exactly one of these:
// - both Citizens voted for the Agent           -> "citizens"
// - 2+ votes landed on the same non-Agent player -> "agent"
// - one vote each (1, 1, 1)                      -> "stalemate"
function decideOutcome(lobby) {
  const { agentId, accusations } = lobby.game;
  const citizens = lobby.players.filter((p) => p.id !== agentId);
  if (citizens.every((p) => accusations[p.id] === agentId)) return "citizens";
  const tally = {};
  for (const target of Object.values(accusations)) tally[target] = (tally[target] || 0) + 1;
  if (Object.entries(tally).some(([id, n]) => id !== agentId && n >= 2)) return "agent";
  return "stalemate";
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
      // phase: "play" (rounds) -> "accuse" (everyone votes for the Agent) -> "result"
      lobby.game = {
        phase: "play",
        round: 1,
        totalRounds: lobby.rounds,
        agentId: null,
        word: null,
        votes: [],
        accusations: {},
        outcome: null,
      };
      startRound(lobby);
      return;
    }
    case "vote": {
      // Toggle your vote for the next round. Enough votes moves everyone on.
      const g = lobby.game;
      if (!g || g.phase !== "play") return;
      if (body.round !== g.round) return; // vote was for a round that already ended
      g.votes = body.on ? [...new Set([...g.votes, me.id])] : g.votes.filter((id) => id !== me.id);
      if (g.votes.length < VOTES_TO_ADVANCE) return;
      if (g.round >= g.totalRounds) {
        g.phase = "accuse";
        g.votes = [];
      } else {
        g.round++;
        startRound(lobby);
      }
      return;
    }
    case "accuse": {
      // Everyone picks who they think the Agent is (not themselves). Votes can change
      // until all are in; then the result is revealed.
      const g = lobby.game;
      if (!g || g.phase !== "accuse") return;
      if (body.target === me.id || !lobby.players.some((p) => p.id === body.target)) fail("Pick another player.");
      g.accusations[me.id] = body.target;
      if (lobby.players.every((p) => g.accusations[p.id])) {
        g.outcome = decideOutcome(lobby);
        g.roster = lobby.players.map(({ id, name, avatar }) => ({ id, name, avatar }));
        g.phase = "result";
      }
      return;
    }
    case "newGame": {
      // From the result screen: everyone goes back to the lobby to set up again.
      if (lobby.game?.phase === "result") lobby.game = null;
      return;
    }
    case "endGame": {
      if (lobby.game && lobby.game.phase !== "result" && isHost) lobby.game = null;
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
  if (lobby.game?.phase === "play") {
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
          phase: lobby.game.phase,
          // During the vote, only show who has voted, not who they picked.
          accused: Object.keys(lobby.game.accusations),
          myAccusation: lobby.game.accusations[me.id] || null,
          result:
            lobby.game.phase === "result"
              ? {
                  outcome: lobby.game.outcome,
                  agentId: lobby.game.agentId,
                  accusations: lobby.game.accusations,
                  roster: lobby.game.roster,
                }
              : null,
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
  decideOutcome,
  staleMs: (lobby) => (lobby.game ? STALE_GAME_MS : STALE_LOBBY_MS),
};
