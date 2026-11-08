const crypto = require("crypto");
const PHRASES = require("./words");

const MAX_PLAYERS = 3;
const VOTES_TO_ADVANCE = 3; // players who must press "Next round" to move on (everyone)
const VOTES_TO_GENERATE = 2; // players who must press "Generate Words" to show the cards
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

// Letters (not spaces or punctuation) are the hangman blanks.
const isLetter = (ch) => /[a-z0-9]/i.test(ch);
const normalize = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Wheel of Fortune style: revealing a letter reveals every copy of it.
function revealLetter(g, letter) {
  const l = letter.toLowerCase();
  [...g.phrase].forEach((ch, i) => {
    if (ch.toLowerCase() === l && !g.revealed.includes(i)) g.revealed.push(i);
  });
}

// One phrase and one Agent for the whole game. Each round starts in the "pick"
// stage (players name public figures, no cards showing); "Generate Words" moves it
// to "reveal". The Agent starts with the first letter of every word (plus a
// one-word synonym as a hint), and every
// round after the first reveals one more (random, still-hidden) letter.
function startRound(lobby) {
  const g = lobby.game;
  if (g.round === 1) {
    // Start with the first letter of every word (each revealed everywhere it appears).
    for (const word of g.phrase.split(/\s+/)) {
      const first = word.match(/[a-z0-9]/i);
      if (first) revealLetter(g, first[0]);
    }
  } else {
    const hidden = [
      ...new Set([...g.phrase].filter((ch, i) => isLetter(ch) && !g.revealed.includes(i)).map((ch) => ch.toLowerCase())),
    ];
    if (hidden.length) revealLetter(g, hidden[crypto.randomInt(hidden.length)]);
  }
  g.votes = [];
  // Round 1 opens straight on the cards, so everyone knows their phrase (or blanks)
  // before the first names are said. Later rounds start in the dark.
  g.stage = g.round === 1 ? "reveal" : "pick";
}

// What the Agent sees: "G_LD__ H___", spaces and punctuation kept.
function maskedPhrase(g) {
  return [...g.phrase].map((ch, i) => (isLetter(ch) && !g.revealed.includes(i) ? "_" : ch)).join("");
}

function endGame(lobby, outcome, reason) {
  const g = lobby.game;
  g.phase = "result";
  g.outcome = outcome; // "citizens" | "agent"
  g.reason = reason; // "locked" | "split" | "guessed"
  g.roster = lobby.players.map(({ id, name, avatar }) => ({ id, name, avatar }));
  g.votes = [];
}

// The game is decided the moment both Citizens are locked in at the same time.
// (Each can't pick themselves, so if they agree they must both have picked the Agent.)
// It's also decided the moment the Agent and a Citizen are locked in on the same
// player (which can only be the other Citizen): the Agent wins.
function checkLocks(lobby) {
  const g = lobby.game;
  const citizens = lobby.players.filter((p) => p.id !== g.agentId);
  if (citizens.every((p) => g.locks[p.id])) {
    const [a, b] = citizens.map((p) => g.locks[p.id]);
    if (a === g.agentId && b === g.agentId) endGame(lobby, "citizens", "locked");
    else endGame(lobby, "agent", "split");
    return;
  }
  const agentLock = g.locks[g.agentId];
  if (agentLock && citizens.some((p) => g.locks[p.id] === agentLock)) endGame(lobby, "agent", "framed");
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
      // phase: "play" (rounds) -> "result"
      const ids = lobby.players.map((p) => p.id);
      const recent = lobby.recentPhrases || [];
      const fresh = PHRASES.filter((p) => !recent.includes(p));
      const phrase = pick(fresh.length ? fresh : PHRASES);
      lobby.recentPhrases = [...recent, phrase].slice(-30); // avoid repeats across games
      lobby.game = {
        phase: "play",
        round: 1,
        totalRounds: lobby.rounds,
        agentId: ids[crypto.randomInt(ids.length)],
        // The Judge rotates around the table each round, starting from a random player.
        judgeStart: crypto.randomInt(ids.length),
        phrase,
        revealed: [], // letter positions the Agent can see
        votes: [],
        locks: {}, // playerId -> who they've locked in as the Agent (private to each player)
        guessRound: 0, // the round the Agent last guessed in (one guess per round)
        guesses: [], // the Agent's wrong guesses, shown at the end
        outcome: null,
      };
      startRound(lobby);
      return;
    }
    case "reveal": {
      // "Generate Words" is a vote too (tap again to undo): enough votes shows the cards.
      // It shares g.votes with Next round; the list is cleared when the stage changes.
      const g = lobby.game;
      if (!g || g.phase !== "play" || g.stage !== "pick" || body.round !== g.round) return;
      g.votes = body.on ? [...new Set([...g.votes, me.id])] : g.votes.filter((id) => id !== me.id);
      if (g.votes.length < VOTES_TO_GENERATE) return;
      g.stage = "reveal";
      g.votes = [];
      return;
    }
    case "vote": {
      // Toggle your vote for the next round. Enough votes moves everyone on.
      const g = lobby.game;
      if (!g || g.phase !== "play" || g.stage !== "reveal") return;
      if (body.round !== g.round) return; // vote was for a round that already ended
      g.votes = body.on ? [...new Set([...g.votes, me.id])] : g.votes.filter((id) => id !== me.id);
      if (g.votes.length < VOTES_TO_ADVANCE) return;
      // The last round can't be skipped: it ends with a lock-in or the Agent's guess.
      if (g.round >= g.totalRounds) {
        g.votes = [];
        return;
      }
      g.round++;
      startRound(lobby);
      return;
    }
    case "lock": {
      // Lock in (or clear, with target null) who you think the Agent is. Everyone has
      // this, so the Agent's screen looks the same. The Agent's lock counts too: if it
      // matches a Citizen's, the Agent wins.
      const g = lobby.game;
      if (!g || g.phase !== "play") return;
      if (body.target == null) {
        delete g.locks[me.id];
        return;
      }
      if (body.target === me.id || !lobby.players.some((p) => p.id === body.target)) fail("Pick another player.");
      g.locks[me.id] = body.target;
      checkLocks(lobby);
      return;
    }
    case "guess": {
      // The Agent guesses the phrase: right wins immediately, one try per round.
      const g = lobby.game;
      if (!g || g.phase !== "play" || me.id !== g.agentId) return;
      if (g.guessRound === g.round) fail("You've already guessed this round.");
      const text = String(body.text || "").trim().slice(0, 80);
      if (!normalize(text)) fail("Type a guess first.");
      g.guessRound = g.round;
      if (normalize(text) === normalize(g.phrase)) {
        g.winningGuess = text;
        endGame(lobby, "agent", "guessed");
      } else {
        g.guesses.push(text);
        g.lastGuessWrong = text;
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

function judgeFor(lobby) {
  const g = lobby.game;
  if (g.phase !== "play" || !lobby.players.length) return null;
  return lobby.players[(g.judgeStart + g.round - 1) % lobby.players.length].id;
}

// What one player is allowed to see. The Agent never receives the phrase
// (only the masked version) until the game is over.
function viewFor(lobby, token) {
  const me = lobby.players.find((p) => p.token === token);
  const g = lobby.game;
  const iAmAgent = g && me.id === g.agentId;
  let card = null;
  if (g?.phase === "play" && g.stage === "reveal") {
    card = iAmAgent
      ? {
          type: "agent",
          mask: maskedPhrase(g),
          hint: PHRASES.hints[g.phrase] || null,
          canGuess: g.guessRound !== g.round,
          lastGuessWrong: g.guessRound === g.round ? g.lastGuessWrong : null,
        }
      : { type: "word", text: g.phrase };
  }
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    rounds: lobby.rounds,
    players: lobby.players.map(({ id, name, avatar }) => ({ id, name, avatar })),
    avatars: AVATARS,
    maxPlayers: MAX_PLAYERS,
    notice: lobby.notice,
    game: g
      ? {
          phase: g.phase,
          round: g.round,
          totalRounds: g.totalRounds,
          votes: g.votes,
          votesNeeded: g.stage === "pick" ? VOTES_TO_GENERATE : VOTES_TO_ADVANCE,
          stage: g.stage,
          judgeId: judgeFor(lobby),
          myLock: g.locks[me.id] || null, // only your own lock is ever sent
          result:
            g.phase === "result"
              ? {
                  outcome: g.outcome,
                  reason: g.reason,
                  agentId: g.agentId,
                  phrase: g.phrase,
                  hint: PHRASES.hints[g.phrase] || null,
                  lettersShown: g.revealed.length,
                  locks: g.locks,
                  winningGuess: g.winningGuess || null,
                  guesses: g.guesses,
                  roster: g.roster,
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
  maskedPhrase,
  normalize,
  staleMs: (lobby) => (lobby.game ? STALE_GAME_MS : STALE_LOBBY_MS),
};
