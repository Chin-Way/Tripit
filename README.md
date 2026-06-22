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

## Accounts, reviews & social (all optional)

TripIt now has an optional backend for accounts, saved trips, family reviews, and
sharing. **None of it is required** — with nothing configured the app behaves exactly
as before: guest mode, on-device storage, the offline PWA shell, and `/api/plan` all
keep working. The new pieces light up only when you configure them, mirroring how the
AI engine activates when a key is present. Run `npm run check` to see what's on.

### Datastore (persistence)

- **Default:** the built-in `node:sqlite` (Node ≥ 22.5) at `data/tripit.db` — zero
  install, perfect for a single instance or local dev.
- **Postgres:** set `DATABASE_URL` and the optional `pg` driver is used instead. Use
  this for a real deployment — **Render's free web disk is ephemeral**, so a SQLite
  file there is wiped on each redeploy. (You can also `npm i better-sqlite3` to use the
  native SQLite driver; it's auto-detected.)

The schema (users, sessions, trips, reviews, reports, and group/message tables for the
next phase) is created automatically on first boot. If the store can't be opened, the
server logs a warning and simply runs in guest mode.

### Social login

Sign-in uses standard OAuth, hand-rolled with Node's `crypto` (no auth dependencies).
Each provider activates only when **both** its id and secret are set, and its button
appears in the app automatically:

| Provider | Env vars | Redirect / return URL |
|---|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `<PUBLIC_BASE_URL>/api/auth/google/callback` |
| Facebook | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | `<PUBLIC_BASE_URL>/api/auth/facebook/callback` |
| Apple | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | `<PUBLIC_BASE_URL>/api/auth/apple/callback` |

Also set `SESSION_SECRET` (signs the OAuth state cookie) and `PUBLIC_BASE_URL` (used to
build redirect URIs). Sessions are server-side, revocable tokens in an HttpOnly,
SameSite=Lax, Secure cookie.

> **Why not Instagram / TikTok login?** Instagram Basic Display was deprecated and both
> platforms target business/creator accounts — there's no reliable general-purpose
> consumer login. So they're treated as **share targets**, not sign-in.

### Reviews, testimonies & moderation

Families can review a venue, a hotel, or a whole trip (1–5 stars, text, optional photo).
Photos are downscaled in the browser and stored size-capped, so there's no filesystem
dependency. Moderation is built in for a kids' product: a family-friendly keyword filter
on submit, an open **report/flag** path that auto-hides content past a threshold, and
admin **hide/remove/restore** for anyone listed in `ADMIN_EMAILS`.

### Sharing

One tap shares a trip via the **Web Share API** (works on mobile for IG/TikTok/FB/etc.),
with a fallback sheet for WhatsApp, Facebook, X, email, and copy-link on desktop. Saved
trips get a read-only public link (`/?trip=<token>`). *Programmatic* posting via the
official TikTok/Instagram APIs needs app review and business accounts — that's an
approval-gated phase 2; everything here works today via Web Share.

### Trip groups & discussion

The **Group** tab lets several families plan together: start a group around a saved
trip, share a `/?group=<token>` invite link, see the members and a shared trip view,
and chat in a threaded discussion. Access is gated by group membership; the same
family-friendly filter applies to messages, and authors (or the group owner) can delete.

### Transportation & bookings (door-to-door)

Every itinerary now carries **transport for each leg** — between stops, hotel↔stop, and
airport↔hotel. Each leg shows **rideshare / transit / walk / drive** with a time and cost
estimate and a one-tap **Book ride** / **Buy ticket**; a **No-walking mode** toggle
schedules a ride or transit for every hop (even short ones) and shows a per-day transport
summary (total time + cost). The **Booked** tab is a full **Reservations** view — flights,
hotel, rides, and restaurant tables, each with a confirmation code and time — plus a
one-tap **"Book this trip"** that books the whole plan end-to-end.

- **Simulated, demo-safe.** Bookings are simulated end-to-end (confirmation codes + saved
  reservations), clearly labeled "Demo", with **no payment**. Gated by `DEMO_BOOKINGS`
  (default on) — the booking analog of `DEMO_AUTH`. Estimates are deterministic
  (`lib/transport.js`): haversine distances where coordinates are known (Google Places, or
  the `lib/geo.js` seed overlay), a neighborhood heuristic otherwise — no key, no network.
- **Real, free deep links** so every button goes somewhere today: Uber universal links
  (pickup/dropoff lat/lng), Google Maps transit/driving directions, Google Flights, and
  OpenTable search.
- **Add to Apple Wallet** — each reservation renders an in-app Wallet pass (boarding-pass
  style with a barcode of the confirmation), with an *Add to Apple Wallet* button and an
  *Add all* shortcut. Simulated and labeled demo (`DEMO_WALLET`, default on); real
  installable `.pkpass` passes need an Apple Pass Type ID cert (`APPLE_PASS_*`) and are the
  approval-gated phase 2 (`lib/wallet.js`).
- **Real provider APIs are an approval-gated phase 2** (like native social posting): swap
  `simulateBooking()` in `lib/bookings.js` for a provider call behind that provider's env
  key (placeholders in `render.yaml` / `.env.example`), and set `DEMO_BOOKINGS=0`.

Guests' reservations live on-device (localStorage); signed-in users with a datastore
persist them (the `bookings` table) so the Booked view follows them across devices.

### The AI feedback loop (consented)

Reviews where a family ticked **"use my review to improve TripIt"** become a structured
signal (this is *not* in-app fine-tuning of a foundation model). For each city we
aggregate consented, visible reviews per venue into an average + volume, shrink it by
confidence, and feed it back two ways:

- **Ranking:** `lib/engine.js` adds a bounded `familyBoost` so well-reviewed venues rank
  a little higher (and poorly-reviewed ones lower) in both the rules and AI plans.
- **Prompt grounding:** `lib/aiShared.js` appends a short "family signals" block to the
  AI prompt (RAG-style) so the model gently prefers community favorites.

It's best-effort — with no datastore the signal is empty and planning is unchanged. For a
future curated fine-tuning set, `npm run export:feedback` writes the consented reviews to
JSONL (`feedback-export.jsonl`, git-ignored — it contains user content; curate before use).

### Privacy & child safety

- **Consent:** the "use my review to improve TripIt" checkbox is **opt-in (off by
  default)** and stored per review. Reviews can be deleted.
- **Children's data:** accounts are for parents/adults. TripIt stores only kids' **age
  bands** (e.g. "2–3 yrs") — never names or other children's PII — which keeps it on the
  right side of COPPA's spirit. Full COPPA/GDPR compliance (e.g. a formal privacy policy,
  data-subject requests) is out of scope for this prototype but the data model is built
  to support it.
- **Secrets** stay in env vars (`.env` locally, the dashboard in prod), never in the repo.

See `docs/PLAN.md` for the full architecture. Phases P1–P5 (auth + persistence, reviews +
sharing, groups, the consented AI feedback loop, and door-to-door transport + simulated
bookings) are implemented; native social-API posting and real booking-provider APIs remain
the approval-gated next steps.

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
- [x] Plan **any city** — the survey asks where you're headed; the Places layer
      fetches that city (any city with a key).
- [x] **Seeded cities for the keyless demo:** Chicago, New York, San Francisco,
      Washington DC, San Diego (each ~11–16 venues + hotels in `data/*.json`).
      Cities outside this set show a "try one of these" prompt unless a Places key
      is set. The survey chips come from `GET /api/cities`.
- [x] **City-aware Stay tab** — hotels come from each city's data; cities without
      hotel data show a "coming soon" state.
- [x] **User accounts + saved trips in a database** — optional SQLite/Postgres backend
      with Google/Facebook/Apple sign-in (guest mode still works). See *Accounts,
      reviews & social* above.
- [x] **Family reviews & testimonies** with photos, moderation, and an opt-in consent
      flag, tied to venues, hotels, or a whole trip.
- [x] **One-tap sharing** via the Web Share API with per-platform fallbacks and
      read-only shared-trip links.
- [x] **Trip groups & discussion** (P3) — start a group around a trip, invite other
      families with a link, a shared trip view, and threaded comments (member-gated).
- [x] **AI feedback loop** (P4) — consented reviews nudge the engine's ranking and ground
      the AI prompt (RAG-style); `npm run export:feedback` exports a curated dataset.
- [x] **Door-to-door transport & bookings** (P5) — per-leg rideshare/transit/walk/drive
      with time + cost, No-walking mode, and a **Booked** Reservations view (flights, hotel,
      rides, tables with confirmation codes). Simulated via `DEMO_BOOKINGS`; real deep links
      to Google Flights/Maps, Uber & OpenTable work today.
- [ ] **Real booking-provider APIs** (approval-gated phase 2) — Uber / airlines / OpenTable /
      hotels; swap `simulateBooking()` in `lib/bookings.js`, set `DEMO_BOOKINGS=0`.
- [ ] Native IG/TikTok/Facebook API posting (approval-gated; Web Share works today).
- [ ] Real PNG app icons (an SVG icon is included for now).
- [ ] Free-trial paywall + subscription ($9.99/mo per the deck) via Stripe / RevenueCat.
