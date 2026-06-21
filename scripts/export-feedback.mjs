// scripts/export-feedback.mjs
// Export the consented feedback dataset as JSONL — the documented path toward a
// future curated fine-tuning set. ONLY reviews where the family opted in
// (consent_ai=1) and that are visible are included.
//
//   npm run export:feedback            -> feedback-export.jsonl
//   npm run export:feedback mine.jsonl -> custom path
//
// Each line is one review: { id, subject_type, subject_id, city, rating, title,
// body, created_at }. Curate/transform downstream before any training use.

import { loadEnv } from "../lib/env.js";
loadEnv();

import { writeFileSync } from "node:fs";
import { getDb } from "../lib/db/index.js";
import { exportConsented } from "../lib/feedback.js";

const db = await getDb();
if (!db) {
  console.error("No datastore available (set DATABASE_URL or run where the SQLite file lives).");
  process.exit(1);
}

const rows = await exportConsented(db);
const file = process.argv[2] || "feedback-export.jsonl";
writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
console.log(`Exported ${rows.length} consented review(s) -> ${file}`);
await db.close?.();
