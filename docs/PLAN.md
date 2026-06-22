# TripIt — Accounts, Reviews, Groups, Social & AI Feedback

This is the approved, phased plan for turning TripIt from a stateless, client-only
prototype into a family product with accounts, user-generated reviews, social sharing,
trip groups, and a consented feedback loop for the recommender.

## Guiding principle

**Everything new is additive and degrades gracefully.** Guest mode (today's behavior)
must keep working with no login, no database, and no secrets configured.
`/api/plan`, `/api/cities`, the per-city seed data, and the offline PWA shell are
untouched on their happy paths. If the DB fails to open or no OAuth provider is
configured, the app still runs exactly as it does today — persistence/auth/UGC routes
simply report "unavailable" and the front-end shows guest-only UI.

## Decisions

| Area | Decision |
|---|---|
| Datastore | Built-in **`node:sqlite`** by default (zero install, Node ≥22.5); **Postgres** when `DATABASE_URL` is set (optional `pg` dep). `better-sqlite3` auto-detected if installed. |
| Login | **Google + Facebook + Apple** via OAuth (hand-rolled with `node:crypto`, no auth deps). Instagram/TikTok are **share targets only** (no general-purpose consumer login). |
| Sessions | Server-side, DB-backed opaque tokens in an HTTP-only, `SameSite=Lax`, `Secure` cookie. Revocable. |
| AI feedback (P4) | Consented review store → engine reweighting → RAG-style prompt grounding → documented curated-dataset export. Not literal in-app fine-tuning. |
| Photos | Client-downscaled data-URIs (size-capped) stored in the DB — no filesystem dependency. Documented S3/R2 upgrade path. |
| Transport | Deterministic per-leg estimates (haversine when coords are known, neighborhood heuristic otherwise) with rideshare/transit/walk/drive time + cost. No key, no network. Real **Uber universal** and **Google Maps directions** deep links. |
| Bookings | **Simulated** end-to-end (confirmation codes + saved reservations), gated by `DEMO_BOOKINGS` (default on, mirrors `DEMO_AUTH`). Real Uber/airline/OpenTable/hotel APIs are an **approval-gated phase 2**. Free deep links (Google Flights/Maps, Uber, OpenTable) work today with no key. **No real payments.** |

## New dependencies

- **Mandatory:** none. SQLite uses the built-in `node:sqlite`.
- **Optional:** `pg` (Postgres, lazy-loaded only when `DATABASE_URL` is set).
- OAuth, sessions, cookies, and Apple's ES256 client-secret JWT are implemented with
  Node's built-in `crypto` — no `passport`/`jsonwebtoken`/`cookie` packages.

## Environment variables (all optional, gated; `sync: false` in render.yaml)

```
DATABASE_URL              # set → use Postgres instead of SQLite
SQLITE_PATH               # optional override for the SQLite file (default ./data/tripit.db)
SESSION_SECRET            # signs OAuth state + cookie integrity (random 32+ bytes)
PUBLIC_BASE_URL           # e.g. https://tripit.onrender.com (for OAuth redirect URIs)
ADMIN_EMAILS              # comma-separated allowlist for moderation actions
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET
APPLE_CLIENT_ID / APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY
```

## Data model

- **users**: `id, provider, provider_user_id, email, display_name, avatar_url, created_at`, unique(provider, provider_user_id)
- **sessions**: `id (token), user_id, created_at, expires_at, user_agent`
- **trips**: `id, owner_user_id, city, survey_json, plan_json, title, share_token, visibility, created_at, updated_at`
- **reviews**: `id, user_id, subject_type (venue|hotel|trip), subject_id, city, rating, title, body, photo, status (visible|flagged|removed), consent_ai, created_at, updated_at`
- **review_reports**: `id, review_id, reporter_user_id, reason, status, created_at`
- *(P3)* **groups, group_members, messages** — created now, wired later
- *(P4)* aggregated **feedback_signals** view + export script
- **bookings** (P5): `id, user_id, trip_id, kind (flight|hotel|restaurant|ride|transit|car), title, subtitle, city, starts_at, day_id, confirmation, cost_cents, currency, status (confirmed|cancelled), detail_json, created_at, updated_at`. Guests keep bookings in localStorage; signed-in users with a datastore persist them here.

All columns are portable types (TEXT ids via `randomUUID`, INTEGER 0/1 booleans,
ISO-8601 TEXT timestamps, JSON stored as TEXT) so the same schema runs on SQLite and
Postgres. Placeholders are written `?` and rewritten to `$1..$n` for Postgres.

## API routes

- **Auth/account:** `GET /api/auth/providers`, `GET /api/auth/:provider/start`,
  `GET|POST /api/auth/:provider/callback`, `POST /api/auth/logout`, `GET /api/me`
- **Trips:** `POST /api/trips`, `GET /api/trips`, `GET /api/trips/:id`, `GET /api/shared/:token`
- **Reviews:** `GET /api/reviews?subjectType&subjectId`, `POST /api/reviews`,
  `POST /api/reviews/:id/report`, `POST /api/reviews/:id/moderate` (admin)
- **Bookings:** `GET /api/bookings/config`, `POST /api/bookings` (simulate + persist),
  `GET /api/bookings?tripId`, `POST /api/bookings/:id/cancel`. Transport legs ride
  along inside `/api/plan` (per-stop `leg`, day `startLeg`/`endLeg`, trip
  `arrival`/`departure`) — additive, so older clients ignore them.

## Phasing

- **P1 (this branch):** DB abstraction + schema, OAuth (Google/Facebook/Apple, env-gated),
  sessions, trip persistence + guest→account migration, **family-friendly UI refresh**
  (warm-light theme + a11y + bigger tap targets + clearer kid info), account UI.
- **P2 (this branch):** reviews/testimonies (venue/hotel/trip) with photo + AI-consent,
  moderation (report/flag + admin hide + keyword soft-filter), one-click **Web Share**
  with per-platform fallbacks.
- **P3 (deferred):** trip groups — invites, shared view, threaded discussion.
- **P4 (deferred):** AI feedback loop (engine reweighting + RAG grounding + dataset
  export). **Native IG/TikTok/FB API posting is approval-gated phase 2** (documented,
  not built).
- **P5 (this branch) — Transportation & bookings:** door-to-door transport woven into
  the itinerary (rideshare/transit/walk/drive per leg with time + cost + real Uber and
  Google Maps deep links), a **No-walking mode** with a per-day transport summary, and
  **simulated end-to-end bookings** (flights, hotel, rides, restaurant tables) surfaced
  in a **Reservations** ("Booked") view — each with a confirmation code and time, plus a
  one-tap "Book this trip". Gated by `DEMO_BOOKINGS` (default on), mirroring `DEMO_AUTH`.
  **Real provider APIs (Uber / airlines / OpenTable / hotels) are an approval-gated
  phase 2:** the seam is `simulateBooking()` in `lib/bookings.js` (swap for a provider
  call behind that provider's env key), with `sync:false` placeholders in
  `render.yaml` / `.env.example`. Free deep links work today with no key; no real
  payment is ever taken.

## Privacy & child safety

- Per-review **AI-consent opt-in (default off)**; "delete my review"; data-ownership copy.
- Moderation: user report/flag, admin hide/remove, lightweight keyword filter on submit,
  auto-hide after repeated reports.
- Accounts are for **adults/parents**. We store kids' **age bands only** — never
  children's names or PII (COPPA-minded). Documented in the README privacy note.
- All secrets are env vars, `sync: false`, never committed.
