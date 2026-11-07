// Local development server: serves public/ and the api/ functions the same way Vercel does.
// Without Upstash env vars, lobbies are kept in memory.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const routes = { "/api/action": require("./api/action"), "/api/state": require("./api/state") };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const handler = routes[url.pathname];
    if (handler) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      req.query = Object.fromEntries(url.searchParams);
      req.body = raw ? JSON.parse(raw) : {};
      res.status = (code) => ((res.statusCode = code), res);
      res.json = (obj) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(obj));
      };
      return handler(req, res);
    }
    const file = path.join(PUBLIC, url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end("Not found");
    }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => {
    const mode = require("./lib/store").usingRedis ? "Upstash Redis" : "in-memory store";
    console.log(`Agent Game running on http://localhost:${PORT} (${mode})`);
  });
