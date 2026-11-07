// POST /api/action  { action, code?, token?, ... }
// Every change to a lobby goes through here. Returns the caller's view of the lobby.
const store = require("../lib/store");
const game = require("../lib/game");

const normCode = (c) => String(c || "").trim().toUpperCase();

async function create(body) {
  let code;
  for (let i = 0; ; i++) {
    code = game.makeCode();
    if (!(await store.getLobby(code)) && (await store.claimCode(code))) break;
    if (i > 20) game.fail("Couldn't create a lobby, try again.");
  }
  const lobby = game.newLobby(code);
  const token = game.addPlayer(lobby, body);
  await store.saveLobby(lobby);
  await store.touch(code, token);
  return { token, state: game.viewFor(lobby, token) };
}

async function join(body) {
  const code = normCode(body.code);
  if (!code) game.fail("Enter a lobby code.");
  return store.withLock(code, async () => {
    const lobby = await store.getLobby(code);
    if (!lobby) game.fail("No lobby with that code.");
    const token = game.addPlayer(lobby, body);
    await store.saveLobby(lobby);
    await store.touch(code, token);
    return { token, state: game.viewFor(lobby, token) };
  });
}

async function act(body) {
  const code = normCode(body.code);
  return store.withLock(code, async () => {
    const lobby = await store.getLobby(code);
    const me = lobby && lobby.players.find((p) => p.token === body.token);
    if (!me) return { gone: true };

    if (body.action === "leave") {
      if (game.removePlayers(lobby, [me.token])) await store.saveLobby(lobby);
      else await store.deleteLobby(code);
      await store.forget(code, [me.token]);
      return { gone: true };
    }

    game.applyAction(lobby, me, body);
    await store.saveLobby(lobby);
    await store.touch(code, me.token);
    return { state: game.viewFor(lobby, me.token) };
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
  try {
    let result;
    if (body.action === "create") result = await create(body);
    else if (body.action === "join") result = await join(body);
    else result = await act(body);
    res.status(200).json(result);
  } catch (e) {
    if (e instanceof game.GameError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
};
