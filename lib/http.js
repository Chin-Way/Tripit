// lib/http.js
// Small shared HTTP helpers used by server.js and the /api handlers, so request
// parsing and JSON responses are consistent (and body size is bounded).

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const MAX_BODY = 4 * 1024 * 1024; // 4 MB — generous for a size-capped review photo

export function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-cache", ...headers });
  res.end(body);
}

export function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { "Content-Type": MIME[".json"], ...headers });
}

export function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-cache" });
  res.end();
}

// Read a request body as text, enforcing a hard size cap.
export async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error("Body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req) {
  const raw = await readRaw(req);
  return raw ? JSON.parse(raw) : {};
}

// Parse a urlencoded body (used for Apple's form_post OAuth callback).
export async function readForm(req) {
  const raw = await readRaw(req);
  return Object.fromEntries(new URLSearchParams(raw));
}

export const query = (req) => new URL(req.url, "http://localhost").searchParams;
