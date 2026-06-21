// lib/api/reviews.js
// HTTP layer for reviews/testimonies: list (with aggregate), create (auth),
// report/flag (open to anyone), and admin moderation.

import { getDb } from "../db/index.js";
import { getSessionUser, isAdmin } from "../auth/session.js";
import { sendJson, query } from "../http.js";
import {
  SUBJECT_TYPES, validateReview, publicReview, aggregateFor,
  listForSubject, createReview, reportReview, moderateReview,
} from "../reviews.js";

// GET /api/reviews?subjectType=&subjectId=
export async function list(req, res) {
  const db = await getDb();
  const q = query(req);
  const subjectType = q.get("subjectType") || "";
  const subjectId = q.get("subjectId") || "";
  if (!SUBJECT_TYPES.has(subjectType) || !subjectId)
    return sendJson(res, 400, { error: "subjectType and subjectId are required" });
  if (!db) return sendJson(res, 200, { reviews: [], aggregate: { count: 0, avg: null }, canModerate: false });

  const user = await getSessionUser(req);
  const admin = isAdmin(user);
  const rows = await listForSubject(db, subjectType, subjectId, { includeHidden: admin });
  const aggregate = await aggregateFor(db, subjectType, subjectId);
  sendJson(res, 200, {
    reviews: rows.map((r) => publicReview(r, user?.id)),
    aggregate,
    canModerate: admin,
  });
}

// POST /api/reviews
export async function create(req, res, body) {
  const db = await getDb();
  if (!db) return sendJson(res, 503, { error: "Reviews are unavailable right now" });
  const user = await getSessionUser(req);
  if (!user) return sendJson(res, 401, { error: "Sign in to post a review" });

  const v = validateReview(body);
  if (!v.ok) return sendJson(res, 400, { error: v.error });

  const row = await createReview(db, user.id, v.value);
  sendJson(res, 200, { review: publicReview(row, user.id) });
}

// POST /api/reviews/:id/report  — anyone (signed-in or guest) can flag UGC.
export async function report(req, res, id, body) {
  const db = await getDb();
  if (!db) return sendJson(res, 503, { error: "Unavailable" });
  const user = await getSessionUser(req);
  const r = await reportReview(db, id, user?.id, body?.reason);
  if (!r.ok) return sendJson(res, 404, { error: r.error || "Not found" });
  sendJson(res, 200, { ok: true, hidden: r.hidden });
}

// POST /api/reviews/:id/moderate  — admin only.
export async function moderate(req, res, id, body) {
  const db = await getDb();
  if (!db) return sendJson(res, 503, { error: "Unavailable" });
  const user = await getSessionUser(req);
  if (!isAdmin(user)) return sendJson(res, 403, { error: "Not allowed" });
  const r = await moderateReview(db, id, body?.action);
  if (!r.ok) return sendJson(res, 400, { error: r.error || "No change" });
  sendJson(res, 200, { ok: true, status: r.status });
}
