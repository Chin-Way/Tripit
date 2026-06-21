// lib/api/auth.js
// Account endpoints: list configured providers, start/return from OAuth, who-am-I,
// and logout. All are safe when persistence or providers are unconfigured.

import { listProviders, isConfigured, providerKnown, demoEnabled, demoLogin, start, handleCallback } from "../auth/oauth.js";
import { getSessionUser, destroySession, isAdmin } from "../auth/session.js";
import { sendJson, redirect, query, readForm } from "../http.js";

// Public, non-sensitive shape of a user for the front-end.
export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.display_name, email: u.email, avatar: u.avatar_url, provider: u.provider, admin: isAdmin(u) };
}

export async function providers(req, res) {
  sendJson(res, 200, { providers: listProviders() });
}

export async function me(req, res) {
  sendJson(res, 200, { user: publicUser(await getSessionUser(req)) });
}

export async function authStart(req, res, provider) {
  try {
    if (isConfigured(provider)) return redirect(res, start(req, res, provider)); // real OAuth
    if (demoEnabled() && providerKnown(provider)) {                              // simulated demo login
      await demoLogin(req, res, provider);
      return redirect(res, "/?signedin=1");
    }
    return sendJson(res, 404, { error: "Provider not available" });
  } catch (e) {
    console.warn("[auth] start failed:", e.message);
    redirect(res, "/?autherror=1");
  }
}

export async function authCallback(req, res, provider) {
  try {
    const params = req.method === "POST" ? await readForm(req) : Object.fromEntries(query(req));
    await handleCallback(req, res, provider, params);
    redirect(res, "/?signedin=1");
  } catch (e) {
    console.warn("[auth] callback failed:", e.message);
    redirect(res, "/?autherror=1");
  }
}

export async function logout(req, res) {
  await destroySession(req, res);
  sendJson(res, 200, { ok: true });
}
