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

1. Get a key at <https://console.anthropic.com> → **API Keys**.
2. Copy `.env.example` to `.env` and paste your key into `ANTHROPIC_API_KEY`.
3. Install the SDK and start:
   ```bash
   npm install
   ANTHROPIC_API_KEY=sk-ant-... npm start
   ```
   (Or just `npm start` if your key is in `.env` and you load it — most hosts inject
   env vars automatically.)

With a key set, Claude (Sonnet 4.6 by default) writes the personalized plan; without
one, the rules engine handles everything. Either way the survey produces a real,
answer-driven itinerary.

---

## How it works

```
 Survey answers ──► POST /api/plan ──►  AI engine (Claude)  ──┐
 (kids, pace,                            └ falls back to ──►   ├──► itinerary JSON ──► UI
  needs, loves)                            rules engine ───────┘
                                          ▲
                        curated venue data (data/chicago.json)
```

- **`data/chicago.json`** — the curated, *grounded* venue list (real ratings, hours,
  stroller/nap/kid-menu attributes). This is what keeps TripIt honest — it never
  invents hours or places. Replace these seed entries with the **Google Places API**
  before launch.
- **`lib/engine.js`** — the deterministic planner. Filters for the family's
  non-negotiables, scores by what they love, schedules around the 1:30–3:00 nap
  window, and keeps each day geographically tight. Always returns a valid plan.
- **`lib/claude.js`** — the AI layer. Claude picks and orders stops from the vetted
  shortlist and writes the "why this fits your family" copy. It only chooses from real
  venues, and we rebuild each card from our data — so ratings/locations can't drift.
- **`server.js`** — tiny Node server: serves `/public` and the `/api/plan` endpoint.
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

- [ ] Swap seed venue data for the **Google Places API** (live hours, photos, ratings).
- [ ] Add more cities beyond Chicago (the engine is city-agnostic — it just needs data).
- [ ] User accounts + saved trips in a database (currently saved on-device only).
- [ ] Wire the **Stay** tab to the data layer / hotel booking affiliates.
- [ ] Real PNG app icons (an SVG icon is included for now).
- [ ] Free-trial paywall + subscription ($9.99/mo per the deck) via Stripe / RevenueCat.
