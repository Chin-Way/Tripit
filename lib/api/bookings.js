// lib/api/bookings.js
// HTTP layer for simulated bookings. Works for everyone:
//   • signed-in + datastore → reservation is persisted (survives across devices)
//   • guest / no datastore   → a simulated confirmation is returned and the
//                              front-end keeps it in localStorage (like saved trips)
// Gated by DEMO_BOOKINGS (default on). With it off and no real provider wired,
// booking reports "unavailable" — guest itinerary planning is unaffected.

import { getDb } from "../db/index.js";
import { getSessionUser } from "../auth/session.js";
import { sendJson, query } from "../http.js";
import {
  demoBookingsEnabled, bookingsConfig, simulateBooking,
  createBooking, listBookings, cancelBooking,
} from "../bookings.js";

// Uniform booking object whether persisted (has id) or ephemeral (guest).
function fullBooking(body, result) {
  return {
    id: result.id || null,
    kind: body.kind,
    title: body.title || null,
    subtitle: body.subtitle || null,
    city: body.city || null,
    time: body.time || null,
    dayId: Number.isInteger(body.dayId) ? body.dayId : null,
    confirmation: result.confirmation,
    status: result.status || "confirmed",
    costCents: Math.max(0, Math.round(body.costCents || 0)),
    currency: body.currency || "USD",
    detail: body.detail || {},
    demo: true,
    persisted: !!result.id,
  };
}

export async function config(req, res) {
  sendJson(res, 200, bookingsConfig());
}

export async function create(req, res, body) {
  if (!demoBookingsEnabled()) return sendJson(res, 503, { error: "Bookings are unavailable right now" });
  if (!body || !body.kind) return sendJson(res, 400, { error: "Missing booking kind" });

  const db = await getDb();
  const user = db ? await getSessionUser(req) : null;
  if (db && user) {
    const created = await createBooking(db, user.id, body); // simulates + persists
    return sendJson(res, 200, { booking: fullBooking(body, created) });
  }
  // guest or no datastore: simulate only; the client stores it locally
  sendJson(res, 200, { booking: fullBooking(body, simulateBooking(body.kind)) });
}

export async function list(req, res) {
  const db = await getDb();
  if (!db) return sendJson(res, 200, { bookings: [] });
  const user = await getSessionUser(req);
  if (!user) return sendJson(res, 200, { bookings: [] });
  const tripId = query(req).get("tripId") || null;
  sendJson(res, 200, { bookings: await listBookings(db, user.id, tripId) });
}

export async function cancel(req, res, id) {
  const db = await getDb();
  if (!db) return sendJson(res, 200, { ok: true }); // guest: client removes its local copy
  const user = await getSessionUser(req);
  if (!user) return sendJson(res, 401, { error: "Sign in required" });
  const r = await cancelBooking(db, user.id, id);
  sendJson(res, r.ok ? 200 : 404, r.ok ? { ok: true } : { error: "Not found" });
}
