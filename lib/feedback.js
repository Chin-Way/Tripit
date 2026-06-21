// lib/feedback.js
// The consented feedback loop (P4). Turns reviews that families opted to share
// ("use my review to improve TripIt") into a structured signal that:
//   1. nudges the deterministic engine's ranking (venue.familyBoost), and
//   2. grounds the AI prompt with aggregated review stats (RAG-style),
// plus a documented export for a future curated fine-tuning dataset.
//
// Only reviews with consent_ai=1 AND status='visible' are ever used here.
// Everything is best-effort: if the DB is unavailable, signals are empty and the
// engine/AI behave exactly as before.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// These MUST match the subject ids the front-end generates for reviews.
const cityKey = (c) => String(c == null ? "" : c).trim().toLowerCase();
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
export const venueSubjectId = (city, name) => `${cityKey(city)}::${slug(name)}`;
export const hotelSubjectId = (city, name) => `${cityKey(city)}::hotel::${slug(name)}`;

// Convert an average rating + volume into a bounded ranking boost. Bayesian-ish
// shrinkage by volume so a single review barely moves anything; a venue with many
// happy families gets a meaningful lift, an unhappy one a penalty. Range ~ ±15.
export function boostFor(avg, n) {
  if (!n) return 0;
  const confidence = n / (n + 3);
  return clamp(avg - 4.0, -1.5, 1.5) * confidence * 10;
}

const TTL_MS = 5 * 60 * 1000; // recompute a city's signals at most every 5 min
const cache = new Map(); // cityKey -> { at, map }

// Map of venue subjectId -> { n, avg, boost } from consented, visible reviews.
export async function getVenueSignals(db, city) {
  if (!db) return new Map();
  const ck = cityKey(city);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  const map = new Map();
  try {
    const rows = await db.all(
      `SELECT subject_id, COUNT(*) AS n, AVG(rating) AS avg
         FROM reviews
        WHERE subject_type='venue' AND consent_ai=1 AND status='visible' AND city=?
        GROUP BY subject_id`, [city]);
    for (const r of rows) {
      const n = Number(r.n || 0), avg = Number(r.avg || 0);
      map.set(r.subject_id, { n, avg, boost: boostFor(avg, n) });
    }
  } catch { /* leave map empty on any error */ }
  cache.set(ck, { at: Date.now(), map });
  return map;
}

// Annotate a city's dataset in place so the engine and AI can read the signal.
// Always resets familyBoost/familySignal so stale values can't linger.
export async function annotateData(db, data) {
  const sigs = await getVenueSignals(db, data.city);
  for (const v of data.venues || []) {
    const s = sigs.get(venueSubjectId(data.city, v.name));
    v.familySignal = s ? { n: s.n, avg: s.avg } : null;
    v.familyBoost = s ? s.boost : 0;
  }
  return data;
}

// A short RAG-style grounding block from the candidates' family signals, for the
// AI system prompt. Returns "" when there are no consented signals yet.
export function groundingText(candidates = []) {
  const lines = candidates
    .filter((v) => v.familySignal && v.familySignal.n > 0)
    .sort((a, b) => b.familySignal.avg - a.familySignal.avg)
    .slice(0, 8)
    .map((v) => `- ${v.name}: ${v.familySignal.avg.toFixed(1)}/5 from ${v.familySignal.n} TripIt famil${v.familySignal.n === 1 ? "y" : "ies"}`);
  if (!lines.length) return "";
  return `\n\nTRIPIT FAMILY SIGNALS (aggregated from families who consented to share their reviews — gently prefer the better-reviewed venues when choosing):\n${lines.join("\n")}`;
}

// Curated export for a future fine-tuning dataset: consented, visible reviews
// with the fields worth keeping. Used by scripts/export-feedback.mjs.
export async function exportConsented(db) {
  if (!db) return [];
  return db.all(
    `SELECT id, subject_type, subject_id, city, rating, title, body, created_at
       FROM reviews
      WHERE consent_ai=1 AND status='visible'
      ORDER BY created_at ASC`);
}
