// lib/engine.js
// Deterministic, rules-based itinerary planner.
// This is the dependable core: given the family's survey answers and a curated
// venue dataset, it filters for non-negotiables, scores by what the family
// loves, and schedules stops around the nap window. It always returns a valid
// plan — so the app works even with no API key or if the AI call fails.

// --- survey value -> meaning maps --------------------------------------------

const YOUNG_KIDS = new Set(["b1", "b2", "b3"]); // 0-1, 2-3, 4-5 yrs

// Which curated category satisfies each "loves" answer.
const LOVE_TO_CATEGORIES = {
  zoo: ["zoo"],
  mus: ["museum"],
  park: ["park", "play"],
  food: ["food"],
  land: ["landmark"],
  water: ["water"],
};

// "needs" that we treat as hard filters on activity tags.
const NEED_TO_TAG = {
  stroller: "stroller",
  chg: "changing",
  out: "outdoor",
  indoor: "indoor",
};

// Stops per day (including one meal) by pace.
const SLOTS_BY_PACE = {
  slow: [
    { t: "9:30 AM", type: "act" },
    { t: "12:30 PM", type: "meal" },
    { t: "2:30 PM", type: "act", nap: true },
  ],
  bal: [
    { t: "9:00 AM", type: "act" },
    { t: "12:00 PM", type: "meal" },
    { t: "2:00 PM", type: "act", nap: true },
    { t: "4:30 PM", type: "act" },
  ],
  fast: [
    { t: "9:00 AM", type: "act" },
    { t: "11:00 AM", type: "act" },
    { t: "12:30 PM", type: "meal" },
    { t: "2:30 PM", type: "act", nap: true },
    { t: "5:00 PM", type: "act" },
  ],
};

const DAYS_BY_LENGTH = { day: 1, wknd: 2, mid: 4, week: 6 };

// --- helpers -----------------------------------------------------------------

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function lovedCategories(loves = []) {
  const out = new Set();
  for (const l of loves) (LOVE_TO_CATEGORIES[l] || []).forEach((c) => out.add(c));
  return out;
}

// Family-fit percentage shown on each card — a blend of the venue's rating and
// how many of the family's needs/loves it hits.
function familyFit(venue, needs, lovedCats) {
  const ratingBonus = (venue.rating ? venue.rating - 4.0 : 0.3) * 10; // 4.8 -> 8
  let needMatch = 0;
  for (const n of needs) {
    const tag = NEED_TO_TAG[n];
    if (tag && venue.tags.includes(tag)) needMatch++;
    if (n === "nap" && venue.napFriendly) needMatch++;
    if (n === "kid" && (venue.tags.includes("kidmenu") || venue.tags.includes("highchair"))) needMatch++;
  }
  const loveMatch = lovedCats.has(venue.category) ? 1 : 0;
  // Small nudge from the consented community signal (P4), bounded so it informs
  // rather than dominates the family-fit percentage.
  const community = clamp(venue.familyBoost || 0, -6, 6);
  return Math.round(clamp(78 + ratingBonus + needMatch * 3 + loveMatch * 6 + community, 82, 98));
}

// Ranking score used to choose which venues make the cut.
function scoreVenue(venue, needs, lovedCats, napProtected) {
  let s = (venue.rating || 4) * 10;
  if (lovedCats.has(venue.category)) s += 30;
  for (const n of needs) {
    const tag = NEED_TO_TAG[n];
    if (tag && venue.tags.includes(tag)) s += 6;
  }
  if (napProtected && venue.napFriendly) s += 8;
  s += venue.familyBoost || 0; // consented community signal (P4); 0 when none
  return s;
}

// Apply hard "needs" filters, but never filter the pool down to nothing —
// relax a constraint rather than return an empty day.
function filterActivities(activities, needs) {
  let pool = activities.slice();
  const wantOutdoor = needs.includes("out");
  const wantIndoor = needs.includes("indoor");

  const requiredTags = [];
  if (needs.includes("stroller")) requiredTags.push("stroller");
  if (needs.includes("chg")) requiredTags.push("changing");

  for (const tag of requiredTags) {
    const next = pool.filter((v) => v.tags.includes(tag));
    if (next.length >= 3) pool = next; // keep the filter only if enough remain
  }

  // Indoor / outdoor: if the family picked exactly one, prefer it but keep the
  // other available so a multi-day trip still has variety.
  if (wantIndoor && !wantOutdoor) {
    const next = pool.filter((v) => v.tags.includes("indoor"));
    if (next.length >= 3) pool = next;
  } else if (wantOutdoor && !wantIndoor) {
    const next = pool.filter((v) => v.tags.includes("outdoor"));
    if (next.length >= 3) pool = next;
  }
  return pool;
}

function filterMeals(meals, needs) {
  if (!needs.includes("kid")) return meals.slice();
  const next = meals.filter((v) => v.tags.includes("kidmenu") || v.tags.includes("highchair"));
  return next.length ? next : meals.slice();
}

function hop(fromVenue, toVenue) {
  if (!fromVenue || !toVenue) return null;
  const sameArea = fromVenue.area === toVenue.area;
  const mins = sameArea ? 8 + Math.round(Math.random() * 4) : 16 + Math.round(Math.random() * 10);
  const tail = sameArea ? "flat, stroller-smooth" : "car seat ready";
  return `${mins} min · ${tail}`;
}

// Convert a curated venue into the card shape the front-end already renders.
function toStop(venue, slot, { isMeal, nap, fit }) {
  const stop = {
    time: slot.t,
    name: venue.name,
    icon: venue.icon,
    color: venue.color,
    meta: venue.meta,
    rating: isMeal ? null : venue.rating, // meals show as a "Smart pick" like the demo
    count: isMeal ? null : venue.count,
    tags: venue.tags,
    why: venue.why,
    score: fit,
    hop: null, // filled in after the day is assembled
    hl: venue.hl || {},
    meal: !!isMeal, // lets the UI offer a restaurant reservation on meal stops
  };
  if (isMeal) {
    stop.rating = venue.rating;
    stop.count = venue.count;
  }
  if (nap) stop.nap = true;
  return stop;
}

// --- main entry --------------------------------------------------------------

export function generatePlan(answers, data) {
  const needs = answers.needs || [];
  const loves = answers.loves || [];
  const kids = answers.kids || [];
  const pace = answers.pace || "bal";
  const length = answers.length || "wknd";

  const lovedCats = lovedCategories(loves);
  const napProtected = needs.includes("nap") && kids.some((k) => YOUNG_KIDS.has(k));

  const venues = data.venues || [];
  const activities = filterActivities(venues.filter((v) => !v.meal), needs);
  const meals = filterMeals(venues.filter((v) => v.meal), needs);

  const rankedActivities = activities
    .map((v) => ({ v, s: scoreVenue(v, needs, lovedCats, napProtected) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
  const rankedMeals = meals
    .map((v) => ({ v, s: scoreVenue(v, needs, lovedCats, napProtected) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);

  const slots = SLOTS_BY_PACE[pace] || SLOTS_BY_PACE.bal;
  const numDays = DAYS_BY_LENGTH[length] || 2;

  const usedIds = new Set();
  const days = [];

  for (let d = 1; d <= numDays; d++) {
    const dayStops = [];
    let dayArea = null; // anchor area to keep a day geographically tight

    for (const slot of slots) {
      if (slot.type === "meal") {
        const meal = rankedMeals.find((v) => !usedIds.has(v.id));
        if (!meal) continue;
        usedIds.add(meal.id);
        dayStops.push({ venue: meal, slot, isMeal: true, nap: false });
        continue;
      }

      const wantNap = slot.nap && napProtected;
      const pick = pickActivity(rankedActivities, usedIds, dayArea, wantNap);
      if (!pick) continue;
      usedIds.add(pick.id);
      if (!dayArea) dayArea = pick.area;
      dayStops.push({ venue: pick, slot, isMeal: false, nap: wantNap && pick.napFriendly });
    }

    // Stop once we can't fill a real day — never emit a meal-only or empty day.
    const activityCount = dayStops.filter((x) => !x.isMeal).length;
    if (activityCount === 0 || dayStops.length < 2) break;

    const stops = dayStops.map(({ venue, slot, isMeal, nap }) =>
      toStop(venue, slot, { isMeal, nap, fit: familyFit(venue, needs, lovedCats) })
    );
    // fill hop hints between consecutive stops
    for (let i = 0; i < stops.length - 1; i++) {
      stops[i].hop = hop(dayStops[i].venue, dayStops[i + 1].venue);
    }
    days.push({ id: d, label: `Day ${d}`, stops });
  }

  return { city: data.city || "Chicago", days, engine: "rules" };
}

// Prefer an unused venue in the anchor area; when a nap slot needs a calm,
// nap-friendly stop, prefer those first.
function pickActivity(ranked, usedIds, anchorArea, wantNap) {
  const avail = ranked.filter((v) => !usedIds.has(v.id));
  if (!avail.length) return null;
  if (wantNap) {
    const napInArea = avail.find((v) => v.napFriendly && v.area === anchorArea);
    if (napInArea) return napInArea;
    const nap = avail.find((v) => v.napFriendly);
    if (nap) return nap;
  }
  if (anchorArea) {
    const inArea = avail.find((v) => v.area === anchorArea);
    if (inArea) return inArea;
  }
  return avail[0];
}

// Exposed so the AI layer can plan from the same vetted shortlist.
export function shortlist(answers, data, limit = 12) {
  const needs = answers.needs || [];
  const lovedCats = lovedCategories(answers.loves || []);
  const napProtected =
    needs.includes("nap") && (answers.kids || []).some((k) => YOUNG_KIDS.has(k));
  return (data.venues || [])
    .map((v) => ({ v, s: scoreVenue(v, needs, lovedCats, napProtected) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.v);
}
