// lib/auth/session.js
// Server-side sessions and signed short-lived cookies, built on node:crypto — no
// auth/cookie packages. Sessions are opaque, high-entropy tokens stored in the DB
// (so they're revocable); the cookie just carries the token. A separate signed
// cookie carries the OAuth `state` (CSRF) across the provider round-trip.

import crypto from "node:crypto";
import { getDb } from "../db/index.js";

const SESSION_COOKIE = "tripit_sess";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// SESSION_SECRET signs the OAuth state cookie. If unset we fall back to a random
// per-process secret (state is short-lived, so this only matters across restarts)
// and warn — set it in production for stable behavior.
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("[auth] SESSION_SECRET not set — using an ephemeral secret (set it in production)");
}

// --- cookie helpers ----------------------------------------------------------

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  const xf = req.headers["x-forwarded-proto"];
  if (xf) return String(xf).split(",")[0].trim() === "https";
  return !!req.socket?.encrypted;
}

// Append a Set-Cookie header (supports multiple cookies per response).
function appendCookie(res, str) {
  const prev = res.getHeader("Set-Cookie");
  const next = prev ? (Array.isArray(prev) ? [...prev, str] : [prev, str]) : str;
  res.setHeader("Set-Cookie", next);
}

export function setCookie(res, req, name, value, { maxAgeMs, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (httpOnly) parts.push("HttpOnly");
  if (isHttps(req)) parts.push("Secure");
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  appendCookie(res, parts.join("; "));
}

export function clearCookie(res, req, name) {
  appendCookie(res, `${name}=; Path=/; Max-Age=0; SameSite=Lax${isHttps(req) ? "; Secure" : ""}`);
}

// --- HMAC sign/verify for the short-lived state cookie -----------------------

function hmac(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function signValue(obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function verifyValue(signed, maxAgeMs) {
  if (!signed || typeof signed !== "string") return null;
  const dot = signed.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = hmac(payload);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (maxAgeMs != null && obj.ts && Date.now() - obj.ts > maxAgeMs) return null;
    return obj;
  } catch {
    return null;
  }
}

// --- sessions ----------------------------------------------------------------

export async function createSession(req, res, userId) {
  const db = await getDb();
  if (!db) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  await db.run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)",
    [token, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString(),
     String(req.headers["user-agent"] || "").slice(0, 200)]
  );
  setCookie(res, req, SESSION_COOKIE, token, { maxAgeMs: SESSION_TTL_MS });
  return token;
}

// Returns the signed-in user row, or null for guests / expired sessions.
export async function getSessionUser(req) {
  const db = await getDb();
  if (!db) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const sess = await db.get("SELECT * FROM sessions WHERE id=?", [token]);
  if (!sess) return null;
  if (new Date(sess.expires_at).getTime() < Date.now()) {
    await db.run("DELETE FROM sessions WHERE id=?", [token]).catch(() => {});
    return null;
  }
  return db.get("SELECT * FROM users WHERE id=?", [sess.user_id]);
}

export async function destroySession(req, res) {
  const db = await getDb();
  const token = parseCookies(req)[SESSION_COOKIE];
  if (db && token) await db.run("DELETE FROM sessions WHERE id=?", [token]).catch(() => {});
  clearCookie(res, req, SESSION_COOKIE);
}

// True if the user's email is in the ADMIN_EMAILS allowlist (for moderation).
export function isAdmin(user) {
  if (!user?.email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(user.email.toLowerCase());
}
