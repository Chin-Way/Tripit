// lib/api/trips.js
// Save trips to an account and read them back (incl. a read-only public share
// link). Guests are unaffected: the front-end keeps using localStorage and only
// calls these when signed in.

import crypto from "node:crypto";
import { getDb } from "../db/index.js";
import { getSessionUser } from "../auth/session.js";
import { sendJson } from "../http.js";

const safeParse = (s) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

async function requireUser(req, res) {
  const u = await getSessionUser(req);
  if (!u) { sendJson(res, 401, { error: "Sign in required" }); return null; }
  return u;
}

function hydrateTrip(t, publicView = false) {
  const out = {
    id: t.id, city: t.city, title: t.title, visibility: t.visibility,
    survey: safeParse(t.survey_json), plan: safeParse(t.plan_json), updatedAt: t.updated_at,
  };
  if (!publicView) out.shareToken = t.share_token;
  return out;
}

export async function createTrip(req, res, body) {
  const db = await getDb();
  if (!db) return sendJson(res, 503, { error: "Saving is unavailable right now" });
  const u = await requireUser(req, res); if (!u) return;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const visibility = body.visibility === "link" ? "link" : "private";
  const shareToken = visibility === "link" ? crypto.randomBytes(9).toString("base64url") : null;
  const title = (body.title || (body.city ? `${body.city} trip` : "My trip")).slice(0, 120);

  await db.run(
    `INSERT INTO trips (id,owner_user_id,city,title,survey_json,plan_json,share_token,visibility,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, u.id, body.city || null, title, JSON.stringify(body.survey || {}),
     JSON.stringify(body.plan || {}), shareToken, visibility, now, now]);
  sendJson(res, 200, { id, shareToken });
}

export async function listTrips(req, res) {
  const db = await getDb();
  if (!db) return sendJson(res, 200, { trips: [] });
  const u = await requireUser(req, res); if (!u) return;
  const rows = await db.all(
    "SELECT id,city,title,visibility,share_token,updated_at FROM trips WHERE owner_user_id=? ORDER BY updated_at DESC",
    [u.id]);
  sendJson(res, 200, {
    trips: rows.map((t) => ({
      id: t.id, city: t.city, title: t.title, visibility: t.visibility,
      shareToken: t.share_token, updatedAt: t.updated_at,
    })),
  });
}

export async function getTrip(req, res, id) {
  const db = await getDb();
  if (!db) return sendJson(res, 404, { error: "Not found" });
  const u = await requireUser(req, res); if (!u) return;
  const t = await db.get("SELECT * FROM trips WHERE id=? AND owner_user_id=?", [id, u.id]);
  if (!t) return sendJson(res, 404, { error: "Not found" });
  sendJson(res, 200, { trip: hydrateTrip(t) });
}

export async function getSharedTrip(req, res, token) {
  const db = await getDb();
  if (!db) return sendJson(res, 404, { error: "Not found" });
  const t = await db.get("SELECT * FROM trips WHERE share_token=?", [token]);
  if (!t) return sendJson(res, 404, { error: "Not found" });
  sendJson(res, 200, { trip: hydrateTrip(t, true) });
}
