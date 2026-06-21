// lib/groups.js
// Trip-group model: a group ties several families around one trip, with an
// invite link and a threaded discussion. Membership (not trip visibility) gates
// access to the shared trip and the messages. Kept separate from the HTTP layer.

import crypto from "node:crypto";
import { containsBlocked } from "./reviews.js";

const NAME_MAX = 80;
const MSG_MAX = 2000;
const safeParse = (s) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

export async function isMember(db, groupId, userId) {
  if (!userId) return false;
  const r = await db.get("SELECT 1 AS ok FROM group_members WHERE group_id=? AND user_id=?", [groupId, userId]);
  return !!r;
}

export async function createGroup(db, userId, { name, tripId } = {}) {
  const id = crypto.randomUUID();
  const inviteToken = crypto.randomBytes(9).toString("base64url");
  const now = new Date().toISOString();

  // Only link a trip the creator actually owns.
  let linkedTrip = null;
  if (tripId) {
    const t = await db.get("SELECT id FROM trips WHERE id=? AND owner_user_id=?", [tripId, userId]);
    if (t) linkedTrip = t.id;
  }
  const groupName = (name || "Our trip group").trim().slice(0, NAME_MAX) || "Our trip group";

  await db.run(
    "INSERT INTO groups (id,trip_id,name,created_by,invite_token,created_at) VALUES (?,?,?,?,?,?)",
    [id, linkedTrip, groupName, userId, inviteToken, now]);
  await db.run(
    "INSERT INTO group_members (group_id,user_id,role,joined_at) VALUES (?,?, 'owner', ?)",
    [id, userId, now]);
  return { id, inviteToken };
}

export async function listMyGroups(db, userId) {
  const rows = await db.all(
    `SELECT g.id, g.name, g.trip_id, gm.role,
            (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id) AS member_count,
            t.city AS trip_city
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       LEFT JOIN trips t ON t.id = g.trip_id
      WHERE gm.user_id=?
      ORDER BY g.created_at DESC`,
    [userId]);
  return rows.map((g) => ({
    id: g.id, name: g.name, role: g.role,
    memberCount: Number(g.member_count || 0), tripCity: g.trip_city || null,
  }));
}

// Full detail for a member: group, members, the shared trip, invite token.
export async function getGroup(db, userId, id) {
  if (!(await isMember(db, id, userId))) return null;
  const g = await db.get("SELECT * FROM groups WHERE id=?", [id]);
  if (!g) return null;

  const members = await db.all(
    `SELECT u.display_name AS name, u.avatar_url AS avatar, gm.role
       FROM group_members gm JOIN users u ON u.id=gm.user_id
      WHERE gm.group_id=? ORDER BY gm.joined_at ASC`, [id]);
  const myRole = (await db.get("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [id, userId]))?.role || "member";

  let trip = null;
  if (g.trip_id) {
    const t = await db.get("SELECT id,city,title,survey_json,plan_json FROM trips WHERE id=?", [g.trip_id]);
    if (t) trip = { id: t.id, city: t.city, title: t.title, survey: safeParse(t.survey_json), plan: safeParse(t.plan_json) };
  }
  return {
    id: g.id, name: g.name, role: myRole, inviteToken: g.invite_token,
    members: members.map((m) => ({ name: m.name || "A TripIt family", avatar: m.avatar, role: m.role })),
    trip,
  };
}

// Public, pre-join preview so an invitee can see what they're joining.
export async function invitePreview(db, token) {
  const g = await db.get("SELECT id,name,trip_id FROM groups WHERE invite_token=?", [token]);
  if (!g) return null;
  const mc = await db.get("SELECT COUNT(*) AS c FROM group_members WHERE group_id=?", [g.id]);
  let city = null;
  if (g.trip_id) city = (await db.get("SELECT city FROM trips WHERE id=?", [g.trip_id]))?.city || null;
  return { name: g.name, memberCount: Number(mc?.c || 0), tripCity: city };
}

export async function joinByToken(db, userId, token) {
  const g = await db.get("SELECT id FROM groups WHERE invite_token=?", [token]);
  if (!g) return { ok: false, error: "Invite not found" };
  if (!(await isMember(db, g.id, userId))) {
    await db.run("INSERT INTO group_members (group_id,user_id,role,joined_at) VALUES (?,?, 'member', ?)",
      [g.id, userId, new Date().toISOString()]);
  }
  return { ok: true, groupId: g.id };
}

export async function listMessages(db, groupId) {
  return db.all(
    `SELECT m.id, m.parent_id, m.user_id, m.body, m.created_at, u.display_name AS author, u.avatar_url AS avatar
       FROM messages m LEFT JOIN users u ON u.id=m.user_id
      WHERE m.group_id=? ORDER BY m.created_at ASC LIMIT 500`, [groupId]);
}

export function publicMessage(m, userId, isOwner) {
  return {
    id: m.id, parentId: m.parent_id || null, author: m.author || "A TripIt family",
    avatar: m.avatar || null, body: m.body, createdAt: m.created_at,
    mine: m.user_id === userId, canDelete: m.user_id === userId || isOwner,
  };
}

export async function postMessage(db, groupId, userId, body, parentId) {
  const text = String(body || "").trim().slice(0, MSG_MAX);
  if (!text) return { ok: false, error: "Message is empty" };
  if (containsBlocked(text)) return { ok: false, error: "Let's keep it family-friendly 💛" };
  const id = crypto.randomUUID();
  await db.run(
    "INSERT INTO messages (id,group_id,user_id,parent_id,body,created_at) VALUES (?,?,?,?,?,?)",
    [id, groupId, userId, parentId || null, text, new Date().toISOString()]);
  return { ok: true, id };
}

export async function deleteMessage(db, groupId, messageId, userId) {
  const m = await db.get("SELECT user_id FROM messages WHERE id=? AND group_id=?", [messageId, groupId]);
  if (!m) return { ok: false };
  const owner = await db.get("SELECT 1 AS ok FROM group_members WHERE group_id=? AND user_id=? AND role='owner'", [groupId, userId]);
  if (m.user_id !== userId && !owner) return { ok: false, error: "Not allowed" };
  await db.run("DELETE FROM messages WHERE id=?", [messageId]);
  return { ok: true };
}
