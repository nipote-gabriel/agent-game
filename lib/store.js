// Storage for lobbies. Uses Upstash Redis when its env vars are set (e.g. on Vercel),
// otherwise an in-memory store for local development.
const LOBBY_TTL_S = 6 * 60 * 60; // lobbies vanish after 6h without changes

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let backend;
if (url && token) {
  const { Redis } = require("@upstash/redis");
  const redis = new Redis({ url, token });
  backend = {
    get: (k) => redis.get(k),
    set: (k, v) => redis.set(k, v, { ex: LOBBY_TTL_S }),
    setNx: async (k, ms) => (await redis.set(k, 1, { nx: true, px: ms })) === "OK",
    del: (k) => redis.del(k),
    hset: async (k, field, v) => {
      await redis.hset(k, { [field]: v });
      await redis.expire(k, LOBBY_TTL_S);
    },
    hgetall: async (k) => (await redis.hgetall(k)) || {},
    hdel: (k, fields) => (fields.length ? redis.hdel(k, ...fields) : 0),
  };
} else {
  const mem = new Map();
  const locks = new Map();
  backend = {
    get: async (k) => (mem.has(k) ? structuredClone(mem.get(k)) : null),
    set: async (k, v) => void mem.set(k, structuredClone(v)),
    setNx: async (k, ms) => {
      if ((locks.get(k) || 0) > Date.now()) return false;
      locks.set(k, Date.now() + ms);
      return true;
    },
    del: async (k) => void (mem.delete(k), locks.delete(k)),
    hset: async (k, f, v) => void mem.set(k, { ...(mem.get(k) || {}), [f]: v }),
    hgetall: async (k) => ({ ...(mem.get(k) || {}) }),
    hdel: async (k, fields) => {
      const h = mem.get(k) || {};
      for (const f of fields) delete h[f];
    },
  };
}

const keys = {
  lobby: (code) => `lobby:${code}`,
  lock: (code) => `lock:${code}`,
  seen: (code) => `seen:${code}`,
};

module.exports = {
  usingRedis: Boolean(url && token),
  getLobby: (code) => backend.get(keys.lobby(code)),
  saveLobby: (lobby) => backend.set(keys.lobby(lobby.code), lobby),
  async deleteLobby(code) {
    await backend.del(keys.lobby(code));
    await backend.del(keys.seen(code));
  },
  claimCode: (code) => backend.setNx(`code:${code}`, LOBBY_TTL_S * 1000),
  touch: (code, playerToken) => backend.hset(keys.seen(code), playerToken, Date.now()),
  seenTimes: (code) => backend.hgetall(keys.seen(code)),
  forget: (code, tokens) => backend.hdel(keys.seen(code), tokens),

  // Serialize changes to one lobby so simultaneous clicks don't overwrite each other.
  async withLock(code, fn) {
    const deadline = Date.now() + 5000;
    while (!(await backend.setNx(keys.lock(code), 5000))) {
      if (Date.now() > deadline) throw new Error("Lobby is busy, try again.");
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
    }
    try {
      return await fn();
    } finally {
      await backend.del(keys.lock(code));
    }
  },
};
