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

import { generatePlan } from "./lib/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

// Load the curated dataset once at startup.
const data = JSON.parse(await readFile(path.join(__dirname, "data", "chicago.json"), "utf8"));

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

  // Try the AI engine first (only does anything if a key is configured),
  // and fall back to the deterministic plan on any problem.
  let plan;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { aiPlan } = await import("./lib/claude.js");
      plan = await aiPlan(answers, data);
    } catch (err) {
      console.warn("[plan] AI engine failed, using rules engine:", err.message);
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
  const mode = process.env.ANTHROPIC_API_KEY
    ? `AI engine on (${process.env.CLAUDE_MODEL || "claude-sonnet-4-6"})`
    : "rules engine (no ANTHROPIC_API_KEY set)";
  console.log(`TripIt running at http://localhost:${PORT}  —  ${mode}`);
});
