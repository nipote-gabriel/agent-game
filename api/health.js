// GET /api/health: quick check that the deployment and Redis are working.
// Shows env var names only, never their values.
const store = require("../lib/store");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const out = {
    ok: false,
    storage: store.usingRedis ? "redis" : store.missingRedis ? "MISSING - connect Upstash Redis" : "in-memory (local dev)",
    redisEnvVars: store.redisEnvVars,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    node: process.version,
  };
  try {
    const t = Date.now();
    await store.ping();
    out.redisPingMs = Date.now() - t;
    out.ok = true;
  } catch (e) {
    out.error = e.message;
  }
  res.status(out.ok ? 200 : 503).json(out);
};
