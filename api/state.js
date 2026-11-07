// GET /api/state?code=ABCD&token=...
// Polled by each client about once a second. Also records that the player is still
// here and removes players who stopped checking in.
const store = require("../lib/store");
const game = require("../lib/game");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const code = String(req.query.code || "").toUpperCase();
  const token = String(req.query.token || "");
  try {
    let lobby = await store.getLobby(code);
    if (!lobby || !lobby.players.some((p) => p.token === token)) return res.status(200).json({ gone: true });

    await store.touch(code, token);
    const seen = await store.seenTimes(code);
    const now = Date.now();
    const isStale = (l) => (p) => now - Number(seen[p.token] || 0) > game.staleMs(l);

    if (lobby.players.some(isStale(lobby))) {
      lobby = await store.withLock(code, async () => {
        const fresh = await store.getLobby(code);
        if (!fresh) return null;
        const stale = fresh.players.filter(isStale(fresh)).map((p) => p.token);
        if (!stale.length) return fresh;
        await store.forget(code, stale);
        if (game.removePlayers(fresh, stale, "A player disconnected, so the game ended.")) {
          await store.saveLobby(fresh);
          return fresh;
        }
        await store.deleteLobby(code);
        return null;
      });
      if (!lobby || !lobby.players.some((p) => p.token === token)) return res.status(200).json({ gone: true });
    }

    res.status(200).json({ state: game.viewFor(lobby, token) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
};
