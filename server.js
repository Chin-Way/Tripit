// server.js
// Tiny Node server: serves the front-end in /public and the JSON API.
//
// Core routes (unchanged, always work — no DB or keys required):
//   POST /api/plan      turn survey answers into an itinerary
//   GET  /api/cities    seeded cities for the keyless demo
//
// Additive routes (activate when a datastore / OAuth provider is configured;
// otherwise they report "unavailable" and guest mode keeps working):
//   /api/auth/*  /api/me  /api/trips*  /api/shared/:token  /api/reviews*
//
// The AI layer activates when ANTHROPIC_API_KEY / GEMINI_API_KEY is set and the
// matching SDK is installed; otherwise the deterministic rules engine handles it.

import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadEnv } from "./lib/env.js";
import { generatePlan } from "./lib/engine.js";
import { getDb } from "./lib/db/index.js";
import { MIME, send, sendJson, readJson, query } from "./lib/http.js";
import * as authApi from "./lib/api/auth.js";
import * as tripsApi from "./lib/api/trips.js";
import * as reviewsApi from "./lib/api/reviews.js";

loadEnv(); // read a local .env file if present (host env vars still win)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

// Load every seed city dataset from /data into a map keyed by lowercased city.
const DATA_DIR = path.join(__dirname, "data");
const seeds = new Map(); // cityLower -> { city, venues, hotels }
for (const f of await readdir(DATA_DIR)) {
  if (!f.endsWith(".json")) continue;
  try {
    const d = JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8"));
    if (d && d.city) seeds.set(d.city.toLowerCase(), d);
  } catch (err) {
    console.warn(`[data] skipped ${f}:`, err.message);
  }
}
const SEED_CITIES = [...seeds.values()].map((d) => d.city).sort();

const PLACES_TTL_MS = 6 * 60 * 60 * 1000; // refresh live venues every 6 hours
const dataCache = new Map(); // cityKey -> { at, data }

function sanitizeCity(c) {
  return typeof c === "string" ? c.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

// Returns the venue dataset for a city. With a Places key, fetches live data for
// any city (cached). Without a key, only the seeded cities are available.
async function getData(cityArg) {
  const cityIn = sanitizeCity(cityArg) || "Chicago";
  const seed = seeds.get(cityIn.toLowerCase());
  const city = seed ? seed.city : cityIn;
  const key = process.env.GOOGLE_PLACES_API_KEY;

  if (!key) return seed || { city, venues: [], hotels: [] };

  const ck = city.toLowerCase();
  const hit = dataCache.get(ck);
  if (hit && Date.now() - hit.at < PLACES_TTL_MS) return hit.data;
  try {
    const { getVenues } = await import("./lib/places.js");
    const venues = await getVenues(city, key);
    const data = { city, venues, hotels: seed ? seed.hotels : [], source: "places" };
    dataCache.set(ck, { at: Date.now(), data });
    console.log(`[places] loaded ${venues.length} live venues for ${city}`);
    return data;
  } catch (err) {
    console.warn(`[places] live fetch failed for ${city}:`, err.message);
    return seed || { city, venues: [], hotels: [] };
  }
}

// Choose the AI engine. AI_PROVIDER forces "claude" or "gemini"; "auto" (default)
// uses whichever API key is set, preferring Claude. Null -> rules engine.
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

// POST /api/plan -> { city, days, engine }
async function handlePlan(req, res) {
  let answers;
  try {
    answers = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  const data = await getData(answers.city);
  if (!data.venues || !data.venues.length) {
    return sendJson(res, 200, { city: data.city, days: [], hotels: data.hotels || [], unavailable: true });
  }

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
  plan.hotels = data.hotels || []; // the city's stays, for the Stay tab

  sendJson(res, 200, plan);
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (urlPath === "/") urlPath = "/index.html";

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

// Route the request. Additive /api routes degrade gracefully when persistence or
// providers aren't configured (their handlers return a friendly "unavailable").
async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const m = req.method;
  const seg = p.split("/").filter(Boolean); // ["api","auth","google","start"]

  // --- core (unchanged) ---
  if (p === "/api/plan" && m === "POST") return handlePlan(req, res);
  if (p === "/api/cities" && m === "GET") return sendJson(res, 200, { cities: SEED_CITIES });

  // --- auth / account ---
  if (p === "/api/auth/providers" && m === "GET") return authApi.providers(req, res);
  if (p === "/api/me" && m === "GET") return authApi.me(req, res);
  if (p === "/api/auth/logout" && m === "POST") return authApi.logout(req, res);
  if (seg[0] === "api" && seg[1] === "auth" && seg.length === 4) {
    const provider = seg[2];
    if (seg[3] === "start" && m === "GET") return authApi.authStart(req, res, provider);
    if (seg[3] === "callback" && (m === "GET" || m === "POST")) return authApi.authCallback(req, res, provider);
  }

  // --- trips ---
  if (p === "/api/trips" && m === "POST") return tripsApi.createTrip(req, res, await readJson(req));
  if (p === "/api/trips" && m === "GET") return tripsApi.listTrips(req, res);
  if (seg[0] === "api" && seg[1] === "trips" && seg.length === 3 && m === "GET")
    return tripsApi.getTrip(req, res, seg[2]);
  if (seg[0] === "api" && seg[1] === "shared" && seg.length === 3 && m === "GET")
    return tripsApi.getSharedTrip(req, res, seg[2]);

  // --- reviews ---
  if (p === "/api/reviews" && m === "GET") return reviewsApi.list(req, res);
  if (p === "/api/reviews" && m === "POST") return reviewsApi.create(req, res, await readJson(req));
  if (seg[0] === "api" && seg[1] === "reviews" && seg.length === 4 && m === "POST") {
    const id = seg[2];
    const body = await readJson(req).catch(() => ({}));
    if (seg[3] === "report") return reviewsApi.report(req, res, id, body);
    if (seg[3] === "moderate") return reviewsApi.moderate(req, res, id, body);
  }

  // --- static / SPA shell ---
  if (m === "GET") return serveStatic(req, res);
  send(res, 405, "Method not allowed");
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    console.error("[server] error:", err);
    if (!res.headersSent) send(res, 500, "Server error");
  }
});

server.listen(PORT, async () => {
  const engine = pickEngine();
  const model = engine
    ? engine.name === "Gemini"
      ? process.env.GEMINI_MODEL || "gemini-2.5-flash"
      : process.env.CLAUDE_MODEL || "claude-sonnet-4-6"
    : null;
  const mode = engine ? `${engine.name} engine on (${model})` : "rules engine (no AI key set)";
  console.log(`TripIt running at http://localhost:${PORT}  —  ${mode}`);
  await getDb(); // warm up persistence (logs whether it's on); never fatal
});
