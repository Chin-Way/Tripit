# TripIt

Family trips, planned around the nap. TripIt turns a 60-second family survey into a
calm, nap-aware, day-by-day itinerary — grounded in real venue data and personalized
by Claude.

This repo contains the working prototype: the polished front-end **plus** a real
itinerary engine behind it (the survey now actually generates the plan).

---

## Quick start

You only need [Node.js](https://nodejs.org) 18+ — no install step for the core app.

```bash
npm start
```

Then open <http://localhost:3000>, take the survey, and you'll get a tailored itinerary.

> Out of the box it runs the **rules engine** (no API key needed), so the app works
> immediately. Add a Claude API key (below) to switch on the **AI engine**.

### Turn on the AI engine (optional)

TripIt supports two AI providers — **Claude** (default) or **Gemini** — chosen with
the `AI_PROVIDER` env var. Either way, the rules engine is the fallback.

**Claude (Anthropic) — default, matches the pitch deck's cost model:**
1. Get a key at <https://console.anthropic.com> → **API Keys**.
2. Copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`.
3. `npm install` then `npm start`.

**Gemini (Google) — alternative:**
1. Get a key at <https://aistudio.google.com/apikey>.
2. In `.env`, set `GEMINI_API_KEY` and `AI_PROVIDER=gemini`.
3. `npm install` then `npm start`.

Switching is just the `AI_PROVIDER` env var — no code change. With no key set, the
rules engine handles everything. Either way the survey produces a real, answer-driven
itinerary.

> **Heads up:** the pitch deck's AI-stack and unit-economics slides are built on
> Claude Sonnet 4.6. If you ship on Gemini, update those numbers so the deck and the
> product match.

### Where your keys go

- **Locally:** copy `.env.example` to `.env` and fill in the values. The app loads
  `.env` automatically when you `npm start` — no need to export anything.
- **On Render (deployed):** your service → **Environment** tab → add each key/value.
  The blueprint (`render.yaml`) already lists them so they appear ready to fill.

### Verify your keys work

```bash
npm run check
```
Pings each service you've configured (Claude, Gemini, Google Places) and prints
OK or the exact error — so you know your keys are live before you demo.

### Live venue data (Google Places)

Set `GOOGLE_PLACES_API_KEY` and TripIt pulls **real venues** (ratings, locations,
opening info, and kid signals like "good for children" / "children's menu" /
wheelchair access) from the Google Places API instead of the seed file. Results
are cached per city (6h) to control cost; without the key, the curated seed data
is used. Get a key in [Google Cloud Console](https://console.cloud.google.com):
enable **Places API (New)** and **billing** (Google gives a recurring monthly credit).

> Places supplies the *facts*. The deep family-logistics tags (nap-timing, changing
> tables) are still partly derived in `lib/places.js` — that curation is TripIt's
> value-add, and where a human-vetted overlay would live.

---

## How it works

```
 Survey answers ──► POST /api/plan ──►  AI engine (Claude or Gemini) ──┐
 (kids, pace,                            └ falls back to ──►            ├──► itinerary JSON ──► UI
  needs, loves)                            rules engine ────────────────┘
                                          ▲
                  venue data: Google Places (live) or data/chicago.json (seed)
```

- **`lib/places.js`** — live venue data from the **Google Places API** (used when
  `GOOGLE_PLACES_API_KEY` is set), mapped into TripIt's schema and cached per city.
- **`data/chicago.json`** — the curated *seed* venue list (real ratings + family
  attributes). Used as the fallback when no Places key is set, and as the source of
  truth for grounding — TripIt never invents hours or places.
- **`lib/engine.js`** — the deterministic planner. Filters for the family's
  non-negotiables, scores by what they love, schedules around the 1:30–3:00 nap
  window, and keeps each day geographically tight. Always returns a valid plan.
- **`lib/claude.js`** / **`lib/gemini.js`** — the AI layer (Claude or Gemini). It picks
  and orders stops from the vetted shortlist and writes the "why this fits your family"
  copy. It only chooses from real venues, and we rebuild each card from our data — so
  ratings/locations can't drift. Shared prompt/parse logic lives in **`lib/aiShared.js`**
  so both providers stay in sync.
- **`server.js`** — tiny Node server: serves `/public` and the `/api/plan` endpoint,
  and routes to the AI provider chosen by `AI_PROVIDER`.
- **`public/index.html`** — the app. The survey now calls `/api/plan`; Saved stops,
  check-offs, and the profile persist on the device.

### Why Sonnet 4.6

It's the cost/quality sweet spot for high-volume itinerary generation — about
**$0.024 per plan**, matching the unit economics in the pitch deck. Change the model
with the `CLAUDE_MODEL` env var (e.g. `claude-opus-4-8` for the hardest planning,
`claude-haiku-4-5` to cut cost). The big prompt is cached, so repeat plans are cheaper.

---

## Deploying (so a QR code can reach it)

Goal: a public URL you can put behind a QR code. Easiest path (free, ~5 minutes):

**1. Deploy on Render**
- Push this repo to GitHub (already done).
- Go to <https://render.com> → **New** → **Blueprint** → pick this repo.
  Render reads `render.yaml` and sets everything up.
- (Optional) Paste your `ANTHROPIC_API_KEY` in the dashboard to turn on the AI
  engine. Skip it and TripIt still works on the rules engine.
- Render gives you a URL like `https://tripit.onrender.com`.

> The blueprint deploys the `claude/ecstatic-cori-im2jpg` branch. Once you merge
> to `main`, change `branch:` in `render.yaml` (or set it in the Render UI).
> Other hosts work too — there's a `Dockerfile` for Railway / Fly.io / Cloud Run.

**2. Make the QR code**
```bash
npm install            # one-time, so the QR tool is available
npm run qr -- https://tripit.onrender.com
```
This prints a scannable QR in your terminal and saves `public/qr.png` (for
slides/printing) and `public/qr.svg`. Drop it in your pitch deck or on a flyer.

**Why one QR does both jobs:** TripIt is a PWA, so scanning it on a phone lets
people **try it in the browser *and* "Add to Home Screen"** to install it like an
app — the "visit the site" and "download the app" goals in one code.

---

## What's next (roadmap)

- [x] Swap seed venue data for the **Google Places API** (live ratings, locations,
      kid attributes) — set `GOOGLE_PLACES_API_KEY`. *Next: map opening hours and
      photos; add a human-vetted overlay for nap-timing/changing tables.*
- [ ] Add more cities beyond Chicago — add a city field to the survey (the Places
      layer is already city-agnostic; it just takes a city string).
- [ ] User accounts + saved trips in a database (currently saved on-device only).
- [ ] Wire the **Stay** tab to the data layer / hotel booking affiliates.
- [ ] Real PNG app icons (an SVG icon is included for now).
- [ ] Free-trial paywall + subscription ($9.99/mo per the deck) via Stripe / RevenueCat.
