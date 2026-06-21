// lib/api/groups.js
// HTTP layer for trip groups: create, list, invite preview, join, detail,
// and threaded discussion. All member-gated except the public invite preview.

import { getDb } from "../db/index.js";
import { getSessionUser } from "../auth/session.js";
import { sendJson } from "../http.js";
import {
  createGroup, listMyGroups, getGroup, invitePreview, joinByToken,
  listMessages, postMessage, deleteMessage, publicMessage, isMember,
} from "../groups.js";

async function requireUser(req, res) {
  const u = await getSessionUser(req);
  if (!u) { sendJson(res, 401, { error: "Sign in required" }); return null; }
  return u;
}

export async function create(req, res, body) {
  const db = await getDb();
  if (!db) return sendJson(res, 503, { error: "Groups are unavailable right now" });
  const u = await requireUser(req, res); if (!u) return;
  const { id, inviteToken } = await createGroup(db, u.id, { name: body?.name, tripId: body?.tripId });
  sendJson(res, 200, { id, inviteToken });
}

export async function list(req, res) {
  const db = await getDb();
  if (!db) return sendJson(res, 200, { groups: [] });
  const u = await requireUser(req, res); if (!u) return;
  sendJson(res, 200, { groups: await listMyGroups(db, u.id) });
}

export async function preview(req, res, token) {
  const db = await getDb();
  if (!db) return sendJson(res, 404, { error: "Not found" });
  const p = await invitePreview(db, token);
  if (!p) return sendJson(res, 404, { error: "Invite not found" });
  sendJson(res, 200, { invite: p });
}

export async function join(req, res, body) {
  const db = await getDb();
  if (!db) return sendJson(res, 503, { error: "Unavailable" });
  const u = await requireUser(req, res); if (!u) return;
  const r = await joinByToken(db, u.id, body?.token);
  if (!r.ok) return sendJson(res, 404, { error: r.error });
  sendJson(res, 200, { ok: true, groupId: r.groupId });
}

export async function detail(req, res, id) {
  const db = await getDb();
  if (!db) return sendJson(res, 404, { error: "Not found" });
  const u = await requireUser(req, res); if (!u) return;
  const g = await getGroup(db, u.id, id);
  if (!g) return sendJson(res, 404, { error: "Not found" });
  sendJson(res, 200, { group: g });
}

export async function messages(req, res, id) {
  const db = await getDb();
  if (!db) return sendJson(res, 200, { messages: [] });
  const u = await requireUser(req, res); if (!u) return;
  if (!(await isMember(db, id, u.id))) return sendJson(res, 403, { error: "Not a member" });
  const owner = !!(await db.get("SELECT 1 AS ok FROM group_members WHERE group_id=? AND user_id=? AND role='owner'", [id, u.id]));
  const rows = await listMessages(db, id);
  sendJson(res, 200, { messages: rows.map((m) => publicMessage(m, u.id, owner)) });
}

export async function postMsg(req, res, id, body) {
  const db = await getDb();
  if (!db) return sendJson(res, 503, { error: "Unavailable" });
  const u = await requireUser(req, res); if (!u) return;
  if (!(await isMember(db, id, u.id))) return sendJson(res, 403, { error: "Not a member" });
  const r = await postMessage(db, id, u.id, body?.body, body?.parentId);
  if (!r.ok) return sendJson(res, 400, { error: r.error });
  sendJson(res, 200, { ok: true, id: r.id });
}

export async function delMsg(req, res, id, mid) {
  const db = await getDb();
  if (!db) return sendJson(res, 503, { error: "Unavailable" });
  const u = await requireUser(req, res); if (!u) return;
  const r = await deleteMessage(db, id, mid, u.id);
  if (!r.ok) return sendJson(res, 403, { error: r.error || "Not allowed" });
  sendJson(res, 200, { ok: true });
}
