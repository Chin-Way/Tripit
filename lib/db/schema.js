// lib/db/schema.js
// Idempotent, dialect-portable schema. Every statement is CREATE ... IF NOT
// EXISTS and uses only types that behave the same on SQLite and Postgres:
//   • TEXT ids (app-generated UUIDs) — no AUTOINCREMENT/SERIAL drift
//   • INTEGER 0/1 for booleans
//   • ISO-8601 TEXT timestamps, always written by the app (no DB-default format)
//   • JSON blobs stored as TEXT
//
// Run in order on startup by lib/db/index.js. Tables for later phases (groups,
// messages) are created now so P3/P4 need no migration.

export const SCHEMA = [
  // --- accounts & sessions ---------------------------------------------------
  `CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,
    provider         TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email            TEXT,
    display_name     TEXT,
    avatar_url       TEXT,
    created_at       TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider
     ON users (provider, provider_user_id)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    user_agent  TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`,

  // --- saved trips -----------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS trips (
    id             TEXT PRIMARY KEY,
    owner_user_id  TEXT NOT NULL,
    city           TEXT,
    title          TEXT,
    survey_json    TEXT,
    plan_json      TEXT,
    share_token    TEXT,
    visibility     TEXT NOT NULL DEFAULT 'private',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trips_owner ON trips (owner_user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_share ON trips (share_token)`,

  // --- reviews & testimonies (UGC) ------------------------------------------
  `CREATE TABLE IF NOT EXISTS reviews (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    subject_type  TEXT NOT NULL,            -- venue | hotel | trip
    subject_id    TEXT NOT NULL,
    city          TEXT,
    rating        INTEGER NOT NULL,         -- 1..5
    title         TEXT,
    body          TEXT,
    photo         TEXT,                     -- size-capped data-URI (optional)
    status        TEXT NOT NULL DEFAULT 'visible', -- visible | flagged | removed
    consent_ai    INTEGER NOT NULL DEFAULT 0,      -- opt-in to improve Triperly
    report_count  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_subject
     ON reviews (subject_type, subject_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_consent ON reviews (consent_ai)`,

  `CREATE TABLE IF NOT EXISTS review_reports (
    id                 TEXT PRIMARY KEY,
    review_id          TEXT NOT NULL,
    reporter_user_id   TEXT,
    reason             TEXT,
    status             TEXT NOT NULL DEFAULT 'open', -- open | reviewed | actioned
    created_at         TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reports_review ON review_reports (review_id)`,

  // --- trip groups & discussion (P3 — created now, wired later) --------------
  `CREATE TABLE IF NOT EXISTS groups (
    id            TEXT PRIMARY KEY,
    trip_id       TEXT,
    name          TEXT,
    created_by    TEXT NOT NULL,
    invite_token  TEXT,
    created_at    TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_invite ON groups (invite_token)`,

  `CREATE TABLE IF NOT EXISTS group_members (
    group_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'member', -- owner | member
    joined_at  TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    group_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    parent_id   TEXT,                        -- null = top-level, else a thread reply
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id)`,

  // --- bookings (simulated reservations; see lib/bookings.js / DEMO_BOOKINGS) -
  // Flights, hotels, restaurants, rides & transit booked for a trip. Demo
  // bookings carry a simulated confirmation code; the same shape holds a real
  // provider's confirmation in the approval-gated phase 2.
  `CREATE TABLE IF NOT EXISTS bookings (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    trip_id       TEXT,
    kind          TEXT NOT NULL,             -- flight | hotel | restaurant | ride | transit | car
    title         TEXT,
    subtitle      TEXT,
    city          TEXT,
    starts_at     TEXT,                      -- ISO or display time of the reservation
    day_id        INTEGER,                   -- itinerary day this belongs to (nullable)
    confirmation  TEXT NOT NULL,
    cost_cents    INTEGER NOT NULL DEFAULT 0,
    currency      TEXT NOT NULL DEFAULT 'USD',
    status        TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
    detail_json   TEXT,                      -- mode, deep link, lat/lng, etc.
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_trip ON bookings (trip_id)`,
];
