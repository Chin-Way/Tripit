// lib/bookings.js
// Simulated, demo-safe bookings — the booking equivalent of DEMO_AUTH.
//
// Real airline / Uber / OpenTable / Booking APIs need partnerships, business
// accounts, and approval, so for the demo we SIMULATE the whole flow end-to-end:
// a tap returns a realistic confirmation code + time and (when signed in with a
// datastore) a saved reservation. Everything is clearly labeled "Demo" in the UI
// and no payment is ever taken.
//
// DEMO_BOOKINGS gates the simulation (default ON, like the pitch's DEMO_AUTH).
// Real provider integrations are a documented, approval-gated phase 2: swap
// simulateBooking() for a provider call behind that provider's own env key —
// the API shape and the saved-reservation model stay the same.

import crypto from "node:crypto";

// On by default so a fresh, key-less deploy can demo bookings. Set DEMO_BOOKINGS
// to 0/false/off (and wire real providers) to turn the simulation off.
export const demoBookingsEnabled = () =>
  !["0", "false", "no", "off"].includes(String(process.env.DEMO_BOOKINGS ?? "1").toLowerCase());

// Per-kind confirmation prefixes, chosen to read like real reservation codes.
const PREFIX = { flight: "TF", hotel: "HZ", restaurant: "OT", ride: "UB", transit: "TR", car: "CR" };
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous O/0/I/1

function confirmationCode(kind) {
  const bytes = crypto.randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `${PREFIX[kind] || "TF"}-${s}`;
}

// Produce a simulated confirmation for a booking payload. Synchronous and
// instant — the seam where a real provider call would slot in (phase 2).
export function simulateBooking(kind) {
  return { confirmation: confirmationCode(kind), status: "confirmed", demo: true, bookedAt: new Date().toISOString() };
}

// What the front-end needs to render booking affordances and labels.
export function bookingsConfig() {
  return { enabled: demoBookingsEnabled(), demo: demoBookingsEnabled() };
}

// --- real, free provider deep links (no key, no approval needed) -------------

const enc = encodeURIComponent;

// Google Flights search for a route (and optional date).
export function flightSearchLink({ origin, destination, date } = {}) {
  const q = `Flights from ${origin || "your city"} to ${destination || ""}${date ? ` on ${date}` : ""}`.trim();
  return `https://www.google.com/travel/flights?q=${enc(q)}`;
}

// OpenTable search for a restaurant.
export function restaurantSearchLink({ name, city, covers = 4 } = {}) {
  return `https://www.opentable.com/s?term=${enc([name, city].filter(Boolean).join(" "))}&covers=${covers}`;
}

// Google Hotels / Travel search for a stay (matches the existing Stay tab link).
export function hotelSearchLink({ name, city } = {}) {
  return `https://www.google.com/travel/search?q=${enc([name, city].filter(Boolean).join(" "))}`;
}

// --- persistence (account-scoped; null-safe when no datastore) ---------------
// Guests keep bookings in localStorage on the client; signed-in users with a
// datastore persist here so the Reservations view survives across devices.

const safeParse = (s) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

function rowToBooking(r) {
  return {
    id: r.id, tripId: r.trip_id, kind: r.kind, title: r.title, subtitle: r.subtitle,
    city: r.city, time: r.starts_at, dayId: r.day_id, confirmation: r.confirmation,
    costCents: r.cost_cents, currency: r.currency, status: r.status,
    detail: safeParse(r.detail_json), createdAt: r.created_at, demo: true,
  };
}

export async function createBooking(db, userId, payload) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const sim = simulateBooking(payload.kind);
  await db.run(
    `INSERT INTO bookings
       (id,user_id,trip_id,kind,title,subtitle,city,starts_at,day_id,confirmation,cost_cents,currency,status,detail_json,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, payload.tripId || null, payload.kind, payload.title || null, payload.subtitle || null,
     payload.city || null, payload.time || null, Number.isInteger(payload.dayId) ? payload.dayId : null,
     sim.confirmation, Math.max(0, Math.round(payload.costCents || 0)), payload.currency || "USD",
     "confirmed", JSON.stringify(payload.detail || {}), now, now]
  );
  return { id, ...sim, costCents: Math.max(0, Math.round(payload.costCents || 0)) };
}

export async function listBookings(db, userId, tripId) {
  const rows = tripId
    ? await db.all("SELECT * FROM bookings WHERE user_id=? AND trip_id=? ORDER BY created_at ASC", [userId, tripId])
    : await db.all("SELECT * FROM bookings WHERE user_id=? ORDER BY created_at ASC", [userId]);
  return rows.map(rowToBooking);
}

export async function cancelBooking(db, userId, id) {
  const r = await db.run("UPDATE bookings SET status='cancelled', updated_at=? WHERE id=? AND user_id=?",
    [new Date().toISOString(), id, userId]);
  return { ok: (r.changes || 0) > 0 };
}
