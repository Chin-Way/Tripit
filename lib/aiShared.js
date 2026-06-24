// lib/aiShared.js
// Provider-agnostic AI helpers shared by the Claude and Gemini engines, so both
// build the same prompt and produce the same itinerary shape (no drift).

import { groundingText } from "./feedback.js";

const SLOTS_PER_DAY = { slow: 3, bal: 4, fast: 5 };
const DAYS_BY_LENGTH = { day: 1, wknd: 2, mid: 4, week: 6 };

export function profileText(answers) {
  const label = (arr) => (arr && arr.length ? arr.join(", ") : "none");
  return [
    `Kids' age bands: ${label(answers.kids)}  (b1=0-1, b2=2-3, b3=4-5, b4=6-9, b5=10-12, b6=teens)`,
    `Trip length: ${answers.length || "wknd"}`,
    `Pace: ${answers.pace || "bal"}`,
    `Non-negotiables (needs): ${label(answers.needs)}  (stroller, nap=protect 1:30-3:00 window, kid=kid menus/high chairs, chg=changing tables, out=outdoor, indoor=indoor backup)`,
    `Loves: ${label(answers.loves)}  (zoo, mus=museums, park=playgrounds, food, land=landmarks, water)`,
  ].join("\n");
}

// The system prompt: rules + the grounded venue shortlist the model must plan from.
// `candidates` may carry a `familySignal` (from lib/feedback.js) which we surface
// as aggregated, consented review stats to gently steer the model (RAG-style).
export function buildSystem(candidates, answers, city) {
  const perDay = SLOTS_PER_DAY[answers.pace] || 4;
  const numDays = DAYS_BY_LENGTH[answers.length] || 2;

  const compact = candidates.map((v) => ({
    id: v.id,
    name: v.name,
    area: v.area,
    category: v.category,
    rating: v.rating,
    tags: v.tags,
    napFriendly: !!v.napFriendly,
    meal: !!v.meal,
    note: v.why,
  }));

  return `You are Triperly's itinerary engine. You build calm, realistic, family-friendly day plans for a trip to ${city}.

You will be given a family profile and a SHORTLIST of real, vetted venues. Plan strictly from this shortlist — never invent venues, hours, or ratings.

Rules:
- Build exactly ${numDays} day(s), about ${perDay} stops each, including one meal stop near midday (a venue with "meal": true).
- Honor every non-negotiable. If "nap" is a need and a young child (b1/b2/b3) is present, protect a 1:30-3:00 PM nap window: place a calm, "napFriendly": true stop in the early afternoon and set its "nap": true.
- Keep each day geographically tight (prefer stops in the same or nearby "area") to minimize travel with kids.
- Weight toward the family's "loves" and pace (slow = fewer, calmer stops; fast = more).
- Do not reuse a venue across the trip.
- Order each day morning -> midday meal -> afternoon -> (late afternoon).

For each stop, write a warm, specific 1-2 sentence "why" that ties the venue to THIS family's answers, and optional "hl" highlights keyed by tag (only for tags the venue has, from: stroller, naptimed, kidmenu, indoor, free) — one short sentence each.

Respond with ONLY valid JSON, no markdown, in exactly this shape:
{"days":[{"id":1,"label":"Day 1","stops":[{"venueId":"<id from shortlist>","time":"9:00 AM","nap":false,"why":"...","hl":{"stroller":"..."}}]}]}

SHORTLIST (the only venues you may use):
${JSON.stringify(compact, null, 0)}${groundingText(candidates)}`;
}

// Strip accidental ```json fences and parse.
export function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

// Rebuild full front-end cards from the dataset + the model's choices, so real
// ratings/tags/meta/icons always come from our vetted data, not the model.
export function hydrate(aiDays, data) {
  const byId = new Map((data.venues || []).map((v) => [v.id, v]));
  const days = [];
  for (const day of aiDays || []) {
    const stops = [];
    for (const s of day.stops || []) {
      const v = byId.get(s.venueId);
      if (!v) continue; // ignore anything not in our dataset
      const stop = {
        time: s.time || "",
        name: v.name,
        icon: v.icon,
        color: v.color,
        meta: v.meta,
        rating: v.rating,
        count: v.count,
        tags: v.tags,
        why: (s.why && String(s.why)) || v.why,
        score: Math.round(78 + (v.rating - 4) * 10 + 8),
        hop: null,
        hl: s.hl && typeof s.hl === "object" ? s.hl : v.hl || {},
        meal: !!v.meal,
      };
      if (!v.meal && s.nap) stop.nap = true;
      stops.push(stop);
    }
    if (stops.length) days.push({ id: day.id || days.length + 1, label: day.label || `Day ${days.length + 1}`, stops });
  }
  return days;
}

// Fill the "X min · ..." travel hints between consecutive stops.
export function fillHops(days, data) {
  const byName = new Map((data.venues || []).map((v) => [v.name, v]));
  for (const day of days) {
    for (let i = 0; i < day.stops.length - 1; i++) {
      const a = byName.get(day.stops[i].name);
      const b = byName.get(day.stops[i + 1].name);
      if (a && b) {
        const sameArea = a.area === b.area;
        day.stops[i].hop = `${sameArea ? 9 : 20} min · ${sameArea ? "flat, stroller-smooth" : "car seat ready"}`;
      }
    }
  }
  return days;
}
