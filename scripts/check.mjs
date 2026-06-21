// scripts/check.mjs
// Verify that the API keys you've configured actually work.
//
//   npm run check
//
// Reads keys from .env (or the environment) and pings each configured service
// with a tiny request, reporting OK or the exact error. Nothing is charged
// beyond a negligible test call.

import { loadEnv } from "../lib/env.js";
loadEnv();

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const skip = (m) => console.log(`  \x1b[90m—\x1b[0m ${m}`);

async function checkClaude() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return skip("Claude (ANTHROPIC_API_KEY not set)");
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const r = await client.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
    });
    const text = r.content.find((b) => b.type === "text")?.text?.trim();
    ok(`Claude key works (${model}) — replied: ${JSON.stringify(text)}`);
  } catch (err) {
    bad(`Claude key failed (${model}): ${err.message}`);
  }
}

async function checkGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return skip("Gemini (GEMINI_API_KEY not set)");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: key });
    const r = await ai.models.generateContent({
      model,
      contents: "Reply with the single word OK.",
      config: { maxOutputTokens: 8, thinkingConfig: { thinkingBudget: 0 } },
    });
    ok(`Gemini key works (${model}) — replied: ${JSON.stringify((r.text || "").trim())}`);
  } catch (err) {
    bad(`Gemini key failed (${model}): ${err.message}`);
  }
}

async function checkPlaces() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return skip("Google Places (GOOGLE_PLACES_API_KEY not set) — using seed venue data");
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName",
      },
      body: JSON.stringify({ textQuery: "museum in Chicago", maxResultCount: 1 }),
    });
    if (!res.ok) {
      const body = await res.text();
      return bad(`Places key failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    ok(`Places key works — sample result: ${json.places?.[0]?.displayName?.text || "(none)"}`);
  } catch (err) {
    bad(`Places request failed: ${err.message}`);
  }
}

async function checkDatabase() {
  try {
    const { getDb } = await import("../lib/db/index.js");
    const db = await getDb();
    if (!db) return bad("Datastore not available (could not open a store)");
    const usingPg = !!process.env.DATABASE_URL;
    ok(`Datastore works (${db.dialect})${usingPg ? "" : " — local file; set DATABASE_URL for Postgres"}`);
  } catch (err) {
    bad(`Datastore failed: ${err.message}`);
  }
}

async function checkAuth() {
  const { configuredProviders } = await import("../lib/auth/oauth.js");
  const providers = configuredProviders();
  if (!providers.length) skip("Social login (no OAuth provider configured) — guest mode only");
  else ok(`Social login: ${providers.map((p) => p.label).join(", ")}`);
  if (!process.env.SESSION_SECRET) skip("SESSION_SECRET not set — using an ephemeral secret (set it in prod)");
  else ok("SESSION_SECRET set");
  if (!process.env.PUBLIC_BASE_URL) skip("PUBLIC_BASE_URL not set — redirect URIs inferred from the request host");
  else ok(`PUBLIC_BASE_URL = ${process.env.PUBLIC_BASE_URL}`);
}

function activeProvider() {
  const p = (process.env.AI_PROVIDER || "auto").toLowerCase();
  const c = !!process.env.ANTHROPIC_API_KEY;
  const g = !!process.env.GEMINI_API_KEY;
  if ((p === "claude" || p === "auto") && c) return "Claude";
  if ((p === "gemini" || p === "auto") && g) return "Gemini";
  return "rules engine (no AI key)";
}

console.log("\nChecking configured services...\n");
console.log("AI provider:");
await checkClaude();
await checkGemini();
console.log("\nVenue data:");
await checkPlaces();
console.log("\nAccounts & persistence:");
await checkDatabase();
await checkAuth();
console.log(`\n/api/plan will use: \x1b[36m${activeProvider()}\x1b[0m`);
console.log("(set AI_PROVIDER=claude|gemini to choose; data uses Places when its key is set)\n");
