// lib/reviews.js
// Review/testimony model: validation, the lightweight moderation filter,
// persistence, and aggregation. Kept separate from the HTTP handler so the P4
// AI-feedback loop can reuse the same aggregation/consent queries.

import crypto from "node:crypto";

export const SUBJECT_TYPES = new Set(["venue", "hotel", "trip"]);

const BODY_MAX = 2000;
const TITLE_MAX = 120;
const PHOTO_MAX = 700 * 1024; // ~700 KB; the client downscales before upload
const AUTO_HIDE_REPORTS = 3; // hide pending review after this many reports

// Lightweight first-pass profanity guard. This is intentionally small — the real
// safety net for a family product is the report/flag + admin path below.
const BLOCKED = ["fuck", "shit", "bitch", "asshole", "cunt", "bastard"];
export function containsBlocked(text) {
  const t = String(text || "").toLowerCase();
  return BLOCKED.some((w) => new RegExp(`\\b${w}`, "i").test(t));
}

// Returns { ok:true, value } or { ok:false, error }.
export function validateReview(input = {}) {
  const subjectType = String(input.subjectType || "");
  if (!SUBJECT_TYPES.has(subjectType)) return { ok: false, error: "Unknown subject type" };

  const subjectId = String(input.subjectId || "").trim().slice(0, 200);
  if (!subjectId) return { ok: false, error: "Missing subject" };

  const rating = Math.round(Number(input.rating));
  if (!(rating >= 1 && rating <= 5)) return { ok: false, error: "Rating must be 1–5 stars" };

  const title = String(input.title || "").trim().slice(0, TITLE_MAX);
  const body = String(input.body || "").trim().slice(0, BODY_MAX);
  if (!body) return { ok: false, error: "Please add a few words" };
  if (containsBlocked(title) || containsBlocked(body))
    return { ok: false, error: "Let's keep reviews family-friendly 💛" };

  let photo = null;
  if (input.photo) {
    const p = String(input.photo);
    if (!p.startsWith("data:image/")) return { ok: false, error: "Photo must be an image" };
    if (p.length > PHOTO_MAX) return { ok: false, error: "Photo is too large" };
    photo = p;
  }

  return {
    ok: true,
    value: {
      subjectType, subjectId,
      city: String(input.city || "").trim().slice(0, 80) || null,
      rating, title: title || null, body, photo,
      consentAi: input.consentAi ? 1 : 0,
    },
  };
}

// Public, non-sensitive shape for the front-end.
export function publicReview(row, currentUserId) {
  return {
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    photo: row.photo,
    author: row.author || "A TripIt family",
    createdAt: row.created_at,
    status: row.status,
    consentAi: !!row.consent_ai,
    mine: !!currentUserId && row.user_id === currentUserId,
  };
}

export async function aggregateFor(db, subjectType, subjectId) {
  const r = await db.get(
    "SELECT COUNT(*) AS count, AVG(rating) AS avg FROM reviews WHERE subject_type=? AND subject_id=? AND status='visible'",
    [subjectType, subjectId]);
  return { count: Number(r?.count || 0), avg: r?.avg != null ? Number(r.avg) : null };
}

export async function listForSubject(db, subjectType, subjectId, { includeHidden = false, limit = 50 } = {}) {
  const statusClause = includeHidden ? "" : "AND r.status='visible'";
  return db.all(
    `SELECT r.*, u.display_name AS author
       FROM reviews r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.subject_type=? AND r.subject_id=? ${statusClause}
      ORDER BY r.created_at DESC LIMIT ?`,
    [subjectType, subjectId, limit]);
}

export async function createReview(db, userId, value) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO reviews (id,user_id,subject_type,subject_id,city,rating,title,body,photo,status,consent_ai,report_count,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'visible', ?, 0, ?, ?)`,
    [id, userId, value.subjectType, value.subjectId, value.city, value.rating,
     value.title, value.body, value.photo, value.consentAi, now, now]);
  return db.get(
    "SELECT r.*, u.display_name AS author FROM reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=?",
    [id]);
}

// Records a report; auto-hides the review once it crosses the threshold.
export async function reportReview(db, reviewId, reporterUserId, reason) {
  const review = await db.get("SELECT * FROM reviews WHERE id=?", [reviewId]);
  if (!review) return { ok: false, error: "Not found" };

  await db.run(
    "INSERT INTO review_reports (id,review_id,reporter_user_id,reason,status,created_at) VALUES (?,?,?,?, 'open', ?)",
    [crypto.randomUUID(), reviewId, reporterUserId || null, String(reason || "").slice(0, 500), new Date().toISOString()]);

  const count = (review.report_count || 0) + 1;
  let hidden = false;
  if (count >= AUTO_HIDE_REPORTS && review.status === "visible") {
    await db.run("UPDATE reviews SET report_count=?, status='flagged', updated_at=? WHERE id=?",
      [count, new Date().toISOString(), reviewId]);
    hidden = true;
  } else {
    await db.run("UPDATE reviews SET report_count=? WHERE id=?", [count, reviewId]);
  }
  return { ok: true, hidden };
}

// Admin moderation: hide | remove | restore.
export async function moderateReview(db, reviewId, action) {
  const map = { hide: "flagged", remove: "removed", restore: "visible" };
  const status = map[action];
  if (!status) return { ok: false, error: "Unknown action" };
  const r = await db.run("UPDATE reviews SET status=?, updated_at=? WHERE id=?",
    [status, new Date().toISOString(), reviewId]);
  return { ok: r.changes > 0, status };
}
