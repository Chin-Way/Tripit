// lib/auth/oauth.js
// Hand-rolled OAuth 2.0 / OIDC for Google, Facebook, and Apple — no auth deps.
// Each provider is independently env-gated: a button only appears when both its
// id and secret are configured, so with no secrets the app stays guest-only and
// nothing breaks. Apple's client secret is an ES256-signed JWT made with crypto.

import crypto from "node:crypto";
import { getDb } from "../db/index.js";
import {
  signValue, verifyValue, setCookie, clearCookie, parseCookies, createSession,
} from "./session.js";

const STATE_COOKIE = "tripit_oauth";
const STATE_TTL_MS = 10 * 60 * 1000; // a login round-trip is short-lived

// --- base URL / redirect URI -------------------------------------------------

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim()
    || (req.socket?.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
const redirectUri = (req, provider) => `${baseUrl(req)}/api/auth/${provider}/callback`;

// --- Apple client secret (ES256 JWT) -----------------------------------------

function appleClientSecret() {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_CLIENT_ID;
  let pk = process.env.APPLE_PRIVATE_KEY;
  if (!teamId || !keyId || !clientId || !pk) throw new Error("Apple not fully configured");
  pk = pk.replace(/\\n/g, "\n"); // allow single-line env values with escaped newlines

  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: "ES256", kid: keyId });
  const body = enc({ iss: teamId, iat: now, exp: now + 3600, aud: "https://appleid.apple.com", sub: clientId });
  const sig = crypto
    .sign("sha256", Buffer.from(`${head}.${body}`), { key: crypto.createPrivateKey(pk), dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${head}.${body}.${sig}`;
}

// --- provider registry -------------------------------------------------------

const PROVIDERS = {
  google: {
    label: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    id: () => process.env.GOOGLE_CLIENT_ID,
    secret: () => process.env.GOOGLE_CLIENT_SECRET,
    configured: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  },
  facebook: {
    label: "Facebook",
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scope: "email public_profile",
    id: () => process.env.FACEBOOK_CLIENT_ID,
    secret: () => process.env.FACEBOOK_CLIENT_SECRET,
    configured: () => !!(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET),
  },
  apple: {
    label: "Apple",
    authUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    scope: "name email",
    responseMode: "form_post", // Apple posts the callback when name/email are requested
    id: () => process.env.APPLE_CLIENT_ID,
    secret: () => appleClientSecret(),
    configured: () =>
      !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID &&
         process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
  },
};

export function configuredProviders() {
  return Object.entries(PROVIDERS)
    .filter(([, p]) => p.configured())
    .map(([key, p]) => ({ key, label: p.label }));
}

export const isConfigured = (provider) => !!PROVIDERS[provider]?.configured();
export const providerKnown = (provider) => !!PROVIDERS[provider];

// DEMO_AUTH turns the un-configured provider buttons into SIMULATED logins so the
// full signed-in experience (reviews, groups) is demoable with no OAuth setup.
export const demoEnabled = () => ["1", "true", "yes", "on"].includes(String(process.env.DEMO_AUTH || "").toLowerCase());

// Buttons to render: real providers when configured; in demo mode, the rest
// appear too, flagged `demo:true`.
export function listProviders() {
  const demo = demoEnabled();
  return Object.entries(PROVIDERS)
    .map(([key, p]) => (p.configured() ? { key, label: p.label, demo: false } : (demo ? { key, label: p.label, demo: true } : null)))
    .filter(Boolean);
}

// Simulated sign-in: creates a real, per-provider demo account + session (so the
// app behaves fully) but skips OAuth. Each provider yields a distinct "family",
// which is handy for demoing a group with several members.
export async function demoLogin(req, res, provider) {
  if (!demoEnabled()) throw new Error("Demo auth disabled");
  if (!PROVIDERS[provider]) throw new Error("Unknown provider");
  const label = PROVIDERS[provider].label;
  const userId = await upsertUser("demo", {
    id: `demo-${provider}`, name: `${label} Demo Family`, email: `demo-${provider}@tripit.local`, avatar: null,
  });
  await createSession(req, res, userId);
}

// --- helpers -----------------------------------------------------------------

function decodeJwtPayload(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

async function upsertUser(provider, profile) {
  const db = await getDb();
  const existing = await db.get(
    "SELECT * FROM users WHERE provider=? AND provider_user_id=?", [provider, profile.id]);
  if (existing) {
    await db.run(
      "UPDATE users SET email=COALESCE(?,email), display_name=COALESCE(?,display_name), avatar_url=COALESCE(?,avatar_url) WHERE id=?",
      [profile.email || null, profile.name || null, profile.avatar || null, existing.id]);
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.run(
    "INSERT INTO users (id,provider,provider_user_id,email,display_name,avatar_url,created_at) VALUES (?,?,?,?,?,?,?)",
    [id, provider, profile.id, profile.email || null, profile.name || null, profile.avatar || null,
     new Date().toISOString()]);
  return id;
}

// --- start: build the consent URL and set a signed state cookie --------------

export function start(req, res, provider) {
  const p = PROVIDERS[provider];
  if (!p || !p.configured()) throw new Error(`Provider not configured: ${provider}`);

  const state = crypto.randomBytes(16).toString("base64url");
  setCookie(res, req, STATE_COOKIE, signValue({ state, provider, ts: Date.now() }),
    { maxAgeMs: STATE_TTL_MS });

  const params = new URLSearchParams({
    client_id: p.id(),
    redirect_uri: redirectUri(req, provider),
    response_type: "code",
    scope: p.scope,
    state,
  });
  if (p.responseMode) params.set("response_mode", p.responseMode);
  return `${p.authUrl}?${params.toString()}`;
}

// --- callback: verify state, exchange code, upsert user, start session -------

export async function handleCallback(req, res, provider, params) {
  const p = PROVIDERS[provider];
  if (!p || !p.configured()) throw new Error(`Provider not configured: ${provider}`);

  if (params.error) throw new Error(`OAuth error: ${params.error}`);

  // CSRF: the state in the signed cookie must match what the provider echoed.
  const cookie = verifyValue(parseCookies(req)[STATE_COOKIE], STATE_TTL_MS);
  clearCookie(res, req, STATE_COOKIE);
  if (!cookie || cookie.provider !== provider || !params.state || cookie.state !== params.state) {
    throw new Error("Invalid OAuth state");
  }
  if (!params.code) throw new Error("Missing authorization code");

  // Exchange the code for tokens.
  const tokenRes = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      client_id: p.id(),
      client_secret: p.secret(),
      redirect_uri: redirectUri(req, provider),
    }).toString(),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status}): ${JSON.stringify(token).slice(0, 200)}`);

  // Resolve the user profile per provider.
  let profile;
  if (provider === "facebook") {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name,email,picture&access_token=${encodeURIComponent(token.access_token)}`);
    const me = await r.json();
    if (!r.ok || !me.id) throw new Error("Facebook profile fetch failed");
    profile = { id: me.id, email: me.email || null, name: me.name || null, avatar: me.picture?.data?.url || null };
  } else {
    // Google & Apple return an OIDC id_token.
    const claims = decodeJwtPayload(token.id_token);
    if (!claims.sub) throw new Error(`${provider} returned no id_token subject`);
    let name = claims.name || null;
    // Apple only sends the name once, as a JSON `user` field on the first callback.
    if (provider === "apple" && params.user) {
      try {
        const u = JSON.parse(params.user);
        if (u?.name) name = [u.name.firstName, u.name.lastName].filter(Boolean).join(" ") || name;
      } catch { /* ignore malformed user payload */ }
    }
    profile = { id: claims.sub, email: claims.email || null, name, avatar: claims.picture || null };
  }

  const userId = await upsertUser(provider, profile);
  await createSession(req, res, userId);
  return { ok: true };
}
