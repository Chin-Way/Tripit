// lib/db/index.js
// Thin data-access layer with a portable, async API over either SQLite or
// Postgres — chosen at runtime so the app keeps the project's "just works" feel:
//
//   • Default: the built-in node:sqlite (Node >=22.5, zero install). If you'd
//     rather use the battle-tested native driver, `npm i better-sqlite3` and it
//     is auto-detected and preferred.
//   • Postgres: set DATABASE_URL and the optional `pg` driver is used instead.
//
// Everything is additive: if no driver can be opened, getDb() resolves to null
// and the caller disables persistence gracefully — guest mode still works.
//
// The public API is always async (so SQLite and Postgres look identical to
// callers) and uses `?` placeholders, which are rewritten to $1..$n for Postgres.
//   const db = await getDb();
//   if (db) { await db.run(sql, [..]); await db.get(sql, [..]); await db.all(sql, [..]); }

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

import { SCHEMA } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SQLITE = path.join(__dirname, "..", "..", "data", "tripit.db");

let initPromise = null; // memoized: init runs exactly once

// Rewrite `?` placeholders to Postgres-style $1..$n (ignores `?` inside strings).
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// --- SQLite (node:sqlite built-in, or better-sqlite3 if installed) -----------
async function openSqlite() {
  const file = process.env.SQLITE_PATH || DEFAULT_SQLITE;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* directory may already exist */
  }

  // Prefer better-sqlite3 when the user has installed it (stable, no warning).
  let handle = null;
  try {
    const { default: Database } = await import("better-sqlite3");
    handle = new Database(file);
  } catch {
    // Fall back to the built-in module. Suppress only its one experimental
    // warning so production logs stay clean; restore the emitter afterwards.
    const origEmit = process.emitWarning;
    process.emitWarning = (w, ...rest) => {
      const s = String(w && w.message ? w.message : w);
      if (s.includes("SQLite is an experimental feature")) return;
      return origEmit.call(process, w, ...rest);
    };
    try {
      const { DatabaseSync } = await import("node:sqlite");
      handle = new DatabaseSync(file);
    } finally {
      process.emitWarning = origEmit;
    }
  }

  handle.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  for (const stmt of SCHEMA) handle.exec(stmt);

  // node:sqlite and better-sqlite3 share the prepare().run/get/all shape, so one
  // adapter covers both. We wrap sync calls in async to match the Postgres path.
  return {
    dialect: "sqlite",
    async run(sql, params = []) {
      const info = handle.prepare(sql).run(...params);
      return { changes: Number(info.changes || 0) };
    },
    async get(sql, params = []) {
      return handle.prepare(sql).get(...params) ?? null;
    },
    async all(sql, params = []) {
      return handle.prepare(sql).all(...params) ?? [];
    },
    async close() {
      try { handle.close(); } catch { /* ignore */ }
    },
  };
}

// --- Postgres (optional `pg` driver, used when DATABASE_URL is set) -----------
async function openPostgres(url) {
  const { default: pg } = await import("pg");
  const ssl = /\bsslmode=require\b/.test(url) || process.env.PGSSL === "1"
    ? { rejectUnauthorized: false }
    : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl });

  await pool.query("SELECT 1"); // fail fast if the connection is bad
  for (const stmt of SCHEMA) await pool.query(stmt);

  return {
    dialect: "postgres",
    async run(sql, params = []) {
      const r = await pool.query(toPg(sql), params);
      return { changes: r.rowCount || 0 };
    },
    async get(sql, params = []) {
      const r = await pool.query(toPg(sql), params);
      return r.rows[0] ?? null;
    },
    async all(sql, params = []) {
      const r = await pool.query(toPg(sql), params);
      return r.rows ?? [];
    },
    async close() {
      try { await pool.end(); } catch { /* ignore */ }
    },
  };
}

async function init() {
  const url = process.env.DATABASE_URL;
  try {
    const db = url ? await openPostgres(url) : await openSqlite();
    console.log(`[db] persistence on (${db.dialect})`);
    return db;
  } catch (err) {
    console.warn(`[db] persistence off — could not open store: ${err.message}`);
    return null; // caller degrades to guest-only / in-memory behavior
  }
}

// Returns the shared DB handle (or null if persistence is unavailable). Safe to
// call from any request; initialization happens once and is reused.
export function getDb() {
  if (!initPromise) initPromise = init();
  return initPromise;
}

// True when a datastore is available — handy for /api gating and diagnostics.
export async function dbReady() {
  return !!(await getDb());
}
