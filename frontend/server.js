const crypto = require("crypto");
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const httpProxy = require("http-proxy");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const BACKEND = process.env.BACKEND_URL || "http://cr_backend:8000";
const INTERNAL_TOKEN = process.env.BACKEND_INTERNAL_TOKEN || "dev-backend-token";
const SESSION_COOKIE_NAME = "cr_session";
const PUBLIC_PATHS = new Set([
  "/login",
  "/auth/login",
  "/manifest.webmanifest",
  "/sw.js",
  "/icon.svg",
  "/icon-maskable.svg",
  "/favicon.ico",
  "/robots.txt",
]);
const PUBLIC_PREFIXES = ["/_next", "/favicon.ico"];

const proxy = httpProxy.createProxyServer({ target: BACKEND, ws: true });

function getSessionToken() {
  const username = process.env.AUTH_USERNAME || "admin";
  const password = process.env.AUTH_PASSWORD || "changeme";
  const secret = process.env.AUTH_SECRET || "dev-auth-secret";

  if (process.env.AUTH_SESSION_TOKEN) {
    return process.env.AUTH_SESSION_TOKEN;
  }

  return crypto
    .createHash("sha256")
    .update(`${username}:${password}:${secret}`)
    .digest("hex");
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((acc, chunk) => {
    const [rawKey, ...rawValue] = chunk.trim().split("=");
    if (!rawKey) return acc;

    acc[rawKey] = decodeURIComponent(rawValue.join("="));
    return acc;
  }, {});
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] === getSessionToken();
}

function isPublicPath(pathname = "/") {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function denyApi(res) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ detail: "Authentication required" }));
}

function redirectToLogin(res) {
  res.writeHead(302, { Location: "/login" });
  res.end();
}

proxy.on("error", (err, req, res) => {
  console.error("[proxy error]", err.message);
  if (res && res.writeHead) {
    res.writeHead(502);
    res.end("Bad gateway");
  }
});

proxy.on("proxyReq", (proxyReq) => {
  proxyReq.setHeader("x-internal-auth", INTERNAL_TOKEN);
});

proxy.on("proxyReqWs", (proxyReq) => {
  proxyReq.setHeader("x-internal-auth", INTERNAL_TOKEN);
});

app.prepare().then(() => {
  const handleUpgrade = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;

    if (pathname.startsWith("/api")) {
      if (!isAuthenticated(req)) {
        denyApi(res);
        return;
      }

      proxy.web(req, res);
    } else if (pathname === "/ws") {
      denyApi(res);
    } else if (!isPublicPath(pathname) && !isAuthenticated(req)) {
      redirectToLogin(res);
    } else {
      handle(req, res, parsedUrl);
    }
  });

  // WebSocket upgrade
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url);
    if (pathname === "/ws") {
      if (!isAuthenticated(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      proxy.ws(req, socket, head);
    } else {
      handleUpgrade(req, socket, head);
    }
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, () => {
    console.log(`> Ready on http://0.0.0.0:${port}`);
  });
});
