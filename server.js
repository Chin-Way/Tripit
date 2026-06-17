// server.js
// Tiny zero-dependency server: serves the front-end in /public and exposes
// POST /api/plan, which turns the survey answers into a real itinerary.
//
// Run:  npm start   (just needs Node — no install required for the core)
// The AI layer activates automatically when ANTHROPIC_API_KEY is set and
// @anthropic-ai/sdk is installed; otherwise the rules engine handles everything.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadEnv } from "./lib/env.js";
import { generatePlan } from "./lib/engine.js";

loadEnv(); // read a local .env file if present (host env vars still win)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

// Seed dataset (fallback). When GOOGLE_PLACES_API_KEY is set we fetch live data
// instead and cache it; otherwise this curated file is used.
const seed = JSON.parse(await readFile(path.join(__dirname, "data", "chicago.json"), "utf8"));

const PLACES_TTL_MS = 6 * 60 * 60 * 1000; // refresh live venues every 6 hours
let dataCache = null; // { at, data }

// Returns the venue dataset for planning: live Google Places data when a key is
// set (cached), otherwise the seed file. Falls back to seed on any error.
async function getData() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return seed;
  if (dataCache && Date.now() - dataCache.at < PLACES_TTL_MS) return dataCache.data;
  try {
    const { getVenues } = await import("./lib/places.js");
    const venues = await getVenues(seed.city || "Chicago", key);
    const data = { city: seed.city || "Chicago", venues, hotels: seed.hotels, source: "places" };
    dataCache = { at: Date.now(), data };
    console.log(`[places] loaded ${venues.length} live venues for ${data.city}`);
    return data;
  } catch (err) {
    console.warn("[places] live fetch failed, using seed data:", err.message);
    return seed;
  }
}

// Choose the AI engine. AI_PROVIDER forces "claude" or "gemini"; "auto" (default)
// uses whichever API key is set, preferring Claude. Returns null when no key is
// available — the caller then uses the deterministic rules engine.
function pickEngine() {
  const provider = (process.env.AI_PROVIDER || "auto").toLowerCase();
  const hasClaude = !!process.env.ANTHROPIC_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;
  if ((provider === "claude" || provider === "auto") && hasClaude)
    return { name: "Claude", module: "./lib/claude.js" };
  if ((provider === "gemini" || provider === "auto") && hasGemini)
    return { name: "Gemini", module: "./lib/gemini.js" };
  return null;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-cache", ...headers });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

// POST /api/plan -> { city, days, engine }
async function handlePlan(req, res) {
  let answers;
  try {
    answers = await readBody(req);
  } catch {
    return send(res, 400, JSON.stringify({ error: "Invalid JSON body" }), {
      "Content-Type": MIME[".json"],
    });
  }

  const data = await getData(); // live Places data when configured, else seed

  // Pick an AI provider and fall back to the deterministic plan on any problem.
  let plan;
  const engine = pickEngine();
  if (engine) {
    try {
      const mod = await import(engine.module);
      plan = await mod.aiPlan(answers, data);
    } catch (err) {
      console.warn(`[plan] ${engine.name} engine failed, using rules engine:`, err.message);
    }
  }
  if (!plan) plan = generatePlan(answers, data);

  send(res, 200, JSON.stringify(plan), { "Content-Type": MIME[".json"] });
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (urlPath === "/") urlPath = "/index.html";

  // Resolve safely inside PUBLIC_DIR (block path traversal).
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");

  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, body, { "Content-Type": MIME[ext] || "application/octet-stream" });
  } catch {
    send(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.split("?")[0] === "/api/plan" && req.method === "POST") {
      return await handlePlan(req, res);
    }
    if (req.method === "GET") return await serveStatic(req, res);
    send(res, 405, "Method not allowed");
  } catch (err) {
    console.error("[server] error:", err);
    send(res, 500, "Server error");
  }
});

server.listen(PORT, () => {
  const engine = pickEngine();
  const model = engine
    ? engine.name === "Gemini"
      ? process.env.GEMINI_MODEL || "gemini-2.5-flash"
      : process.env.CLAUDE_MODEL || "claude-sonnet-4-6"
    : null;
  const mode = engine ? `${engine.name} engine on (${model})` : "rules engine (no AI key set)";
  console.log(`TripIt running at http://localhost:${PORT}  —  ${mode}`);
});
