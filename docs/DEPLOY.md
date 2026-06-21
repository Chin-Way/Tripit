# Turning on accounts, reviews, groups & feedback in production

TripIt deploys and runs with **zero** of this configured (guest mode: itineraries, the
light/dark theme, the share sheet). The steps below switch on the account-gated features
(sign-in, reviews, groups, and the consented feedback loop) on Render.

You'll set values in **Render → your service → Environment**. Every variable is optional
and independent — e.g. you can do Google only and skip Facebook/Apple. A provider's
sign-in button appears only once **both** its id and secret are set.

> Throughout, replace `https://YOUR-APP.onrender.com` with your real Render URL
> (Render → your service → top of the page). It must be **https** with **no trailing slash**.

---

## Fastest path — demo / pitch (no OAuth, no cost)

The `render.yaml` Blueprint already automates the hard parts, so a shareholder-ready
demo needs **no provider setup and no secrets**:

1. Render → **New → Blueprint** → pick this repo → **Apply**. The Blueprint:
   - **auto-creates the `tripit-db` Postgres** and wires `DATABASE_URL`,
   - **auto-generates `SESSION_SECRET`**, and
   - sets **`DEMO_AUTH=1`**.
2. Open the app → **Profile** → tap **Continue with Apple / Google / Facebook**. These
   are **simulated** logins: each creates a real demo account + session, so reviews and
   groups work fully — but no real OAuth, no Apple Developer fee, nothing to configure.
   (A small "Preview mode — sign-in is simulated" note is shown.)
3. To demo a **group with multiple families**, sign in as a *different* provider in a
   second browser/incognito window (each provider = a distinct demo family), then use the
   group's **Invite** link to join.

That's the whole demo. The steps below are only for wiring **real** sign-in later — set
any real provider and its button automatically switches from simulated to real. Turn the
simulation off for production by setting `DEMO_AUTH=0` (or removing it).

> Cost: Render web + Postgres are free (the free DB expires ~30 days after creation, then
> ~\$7/mo to keep). Google/Facebook login are free. Apple is the only paid one (\$99/yr
> Apple Developer) — and the demo skips it entirely.

---

## Step 1 — Add a database (so data survives redeploys)

*(Skip if you used the Blueprint above — the database is already created and wired.)*

Render's free web disk is ephemeral, so use Postgres for real persistence.

1. Render Dashboard → **New → Postgres** → name it `tripit-db` → Free plan → **Create**.
2. Open the database → **Connections** → copy the **Internal Database URL**
   (use Internal when the DB and web service are in the same region).
3. You'll paste it as `DATABASE_URL` in Step 2.

*SSL note:* the Internal URL needs no SSL. If you ever use the **External** URL instead,
append `?sslmode=require` to it (the app enables SSL automatically when it sees that).

---

## Step 2 — Core environment variables

Render → your web service → **Environment** → add each, then **Save Changes**
(Render redeploys automatically).

| Key | Value |
|---|---|
| `DATABASE_URL` | the Internal Database URL from Step 1 |
| `SESSION_SECRET` | a long random string — generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (or `openssl rand -hex 32`) |
| `PUBLIC_BASE_URL` | `https://YOUR-APP.onrender.com` |
| `ADMIN_EMAILS` | comma-separated emails allowed to moderate reviews, e.g. `you@example.com` |

That alone enables **reviews, groups, and the feedback loop** once a user can sign in —
so do at least one provider below.

---

## Step 3 — Google sign-in

1. <https://console.cloud.google.com> → create/select a project.
2. **APIs & Services → OAuth consent screen**: choose **External**, fill app name +
   support email, add scopes `openid`, `email`, `profile`. Add yourself under **Test users**
   (or **Publish** the app to allow anyone).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URIs** → add exactly:
     `https://YOUR-APP.onrender.com/api/auth/google/callback`
   - (optional) Authorized JavaScript origin: `https://YOUR-APP.onrender.com`
4. Copy the credentials into Render:
   - `GOOGLE_CLIENT_ID` = the client ID
   - `GOOGLE_CLIENT_SECRET` = the client secret

---

## Step 4 — Facebook sign-in

1. <https://developers.facebook.com> → **My Apps → Create App** → use case
   **Authenticate and request data from users with Facebook Login** → **Consumer**.
2. Add the **Facebook Login** product → **Settings**:
   - **Valid OAuth Redirect URIs** → add exactly:
     `https://YOUR-APP.onrender.com/api/auth/facebook/callback`
3. **App settings → Basic**: add **App Domain** `YOUR-APP.onrender.com`, set a
   **Privacy Policy URL** (required), then copy:
   - `FACEBOOK_CLIENT_ID` = App ID
   - `FACEBOOK_CLIENT_SECRET` = App Secret
4. Toggle the app to **Live** (top bar). In Development mode only you/testers can log in;
   `email` and `public_profile` need no App Review.

---

## Step 5 — Sign in with Apple (most involved)

Requires a paid **Apple Developer** account. Apple does **not** allow `localhost` return
URLs, so this only works on your https Render URL.

1. <https://developer.apple.com/account> → **Certificates, Identifiers & Profiles**.
2. **Identifiers → +** → **App IDs** → App → enable **Sign In with Apple** capability.
3. **Identifiers → +** → **Services IDs** → create one (e.g. `com.yourco.tripit.web`).
   This string becomes `APPLE_CLIENT_ID`. Edit it → enable **Sign In with Apple** →
   **Configure**:
   - Primary App ID: the App ID from step 2
   - Domains: `YOUR-APP.onrender.com`
   - Return URLs: `https://YOUR-APP.onrender.com/api/auth/apple/callback`
4. **Keys → +** → enable **Sign In with Apple** → register → **Download** the `.p8`
   (one-time download). Note the **Key ID**.
5. Your **Team ID** is top-right of the developer account.
6. Put these in Render:
   - `APPLE_CLIENT_ID` = the Services ID (e.g. `com.yourco.tripit.web`)
   - `APPLE_TEAM_ID` = your 10-char Team ID
   - `APPLE_KEY_ID` = the Key ID from step 4
   - `APPLE_PRIVATE_KEY` = the contents of the `.p8`. Easiest reliable form: open it,
     replace each line break with the two characters `\n`, and paste as one line, e.g.
     `-----BEGIN PRIVATE KEY-----\nMIGTAgEA...\n-----END PRIVATE KEY-----`
     (the app converts `\n` back to real newlines).

---

## Step 6 — Deploy & verify

1. After saving env vars, Render redeploys. (Or **Manual Deploy → Deploy latest commit**.)
2. **Logs** should show `[db] persistence on (postgres)` and `TripIt running…`.
3. Quick check from your machine:
   ```bash
   curl https://YOUR-APP.onrender.com/api/auth/providers
   # -> {"providers":[{"key":"google","label":"Google"}, ...]}
   ```
4. In the app: **Profile** now shows the sign-in buttons → sign in → post a review on a
   stop → open the **Group** tab → start a group and copy the invite link.
5. Moderation: sign in with an email listed in `ADMIN_EMAILS` to see Hide/Remove/Restore
   on reviews.
6. Feedback export (run where the DB is reachable, e.g. locally with the same
   `DATABASE_URL`): `npm run export:feedback` → `feedback-export.jsonl`.

---

## Local development

Copy `.env.example` to `.env` and fill the same keys. Notes:
- `PUBLIC_BASE_URL=http://localhost:3000`, and add the matching `…/callback` URLs to each
  provider (Google/Facebook allow `http://localhost`; **Apple does not** — test Apple on Render).
- With no `DATABASE_URL`, the app uses the built-in SQLite file at `data/tripit.db`.
- `npm run check` reports which providers and datastore are configured.

---

## Troubleshooting

- **`redirect_uri_mismatch` / "invalid redirect"** — the URL registered with the provider
  must match `PUBLIC_BASE_URL` + `/api/auth/<provider>/callback` exactly (scheme, host, path).
- **Buttons don't appear** — that provider is missing its id *or* secret; re-check both.
  Confirm with `/api/auth/providers`.
- **Facebook gives no email** — the app must be **Live** and the user must grant email.
- **Apple "invalid_client"** — usually a wrong `APPLE_TEAM_ID`/`APPLE_KEY_ID`, a mangled
  `APPLE_PRIVATE_KEY` (newlines), or a `APPLE_CLIENT_ID` that isn't the **Services ID**.
- **Logs say `persistence off`** — `DATABASE_URL` missing/incorrect, or (External URL)
  missing `?sslmode=require`.
- **Custom domain later** — update `PUBLIC_BASE_URL` *and* every provider's redirect URI.

---

## Environment variable reference

```
# core
DATABASE_URL            # Render Postgres Internal URL (else built-in SQLite, ephemeral on free web)
SESSION_SECRET          # random 32+ bytes; signs the OAuth state cookie
PUBLIC_BASE_URL         # https://YOUR-APP.onrender.com  (no trailing slash)
ADMIN_EMAILS            # comma-separated moderator emails

# providers (each needs BOTH parts to activate)
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
FACEBOOK_CLIENT_ID
FACEBOOK_CLIENT_SECRET
APPLE_CLIENT_ID         # the Services ID
APPLE_TEAM_ID
APPLE_KEY_ID
APPLE_PRIVATE_KEY       # .p8 contents, newlines as \n
```

Callback URLs to register:
```
https://YOUR-APP.onrender.com/api/auth/google/callback
https://YOUR-APP.onrender.com/api/auth/facebook/callback
https://YOUR-APP.onrender.com/api/auth/apple/callback
```
