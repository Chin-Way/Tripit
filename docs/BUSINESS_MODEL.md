# Triperly — Business Model

> A revised, more defensible model than the single "$9.99/mo subscription" on the
> current deck. Grounded in what the app already does today: nap-aware AI itineraries
> **plus** real door-to-door booking rails (hotels, flights, rides, restaurant tables)
> and a curated family-logistics dataset.

---

## TL;DR — the repositioning

**From:** "A $9.99/mo subscription app."
**To:** **"Free to plan — Triperly earns when your trip actually happens."**

Money follows the **booking**, not a monthly fee. A small membership and B2B
partnerships sit on top. This monetizes the ~95% of users who would never subscribe,
and it matches how families travel: a few trips a year, not every month.

---

## Why the current model is mispriced

| Problem with "$9.99/mo only" | Why it hurts Triperly specifically |
|---|---|
| **Travel is episodic, not monthly.** Families take ~2–4 trips/year. | A monthly sub is bought to plan one trip, then cancelled. Churn is brutal and LTV is tiny — the classic standalone-trip-planner trap. |
| **It monetizes only the few who convert** (typically 2–5% of consumer freemium). | The other 95% still book hotels, rides, and tables *inside the app* — and we earn $0 on any of it. |
| **It ignores where travel money actually is.** | Booking Holdings and Expedia are ~$100B businesses built on **booking commission**, not subscriptions. Triperly already has the booking rail (`lib/bookings.js`, the "Booked"/Reservations view, Uber/Google Flights/OpenTable deep links). |
| **It doesn't price the real moat.** | The AI itinerary is commoditizing. The defensible asset is the **curated family-logistics data** (nap windows, changing tables, kid-friendly signals) + the consented family-review dataset — both licensable B2B, neither in the deck. |

---

## The model: three revenue pillars

### Pillar 1 — Booking commission (primary; scales with *all* users)

Earn affiliate/commission on the bookings the product already routes door-to-door.
Today these are simulated (`DEMO_BOOKINGS=1`) with real free deep links; the
"approval-gated phase 2" swaps `simulateBooking()` for provider/affiliate calls.

| Booking type (already in the app) | How we earn | Illustrative take* |
|---|---|---|
| **Hotels** (Stay tab) | Affiliate via Booking.com/Expedia or hotel-direct | ~4–6% of stay |
| **Attraction & museum tickets** | GetYourGuide / Viator affiliate | ~8–10% |
| **Restaurant tables** | OpenTable referral / per-seated-cover | ~$0.25–1.00 per cover |
| **Rideshare** | Uber affiliate / referral | flat or small % |
| **Flights** | Skyscanner/Kiwi/airline referral | small flat fee |

\* *Illustrative industry ranges, not guarantees — used for modeling.*

**Why this is the right primary engine:** it aligns revenue with value delivered, it
charges nobody to plan (great for acquisition), and it monetizes the free majority.

### Pillar 2 — Triperly+ membership (retention; repriced for travel cadence)

Keep a paid tier, but **stop leading with monthly** — it's the worst value for an
episodic-use app. Lead with cadence-matched options:

| Plan | Price (illustrative) | For whom |
|---|---|---|
| **Trip Pass** (one-time unlock) | **~$7–9 / trip** | The occasional family — pay only when traveling |
| **Triperly+ Annual** ⭐ default | **~$39–49 / yr** | Frequent travelers; best value, lowest churn |
| Monthly | $9.99 / mo (kept as anchor) | The expensive option that makes annual look great |

**Perks are cheap to deliver and genuinely useful:** unlimited AI re-plans (each
costs only **~$0.024**), offline trip packs, multi-family group planning, No-walking
mode, premium cities, and concierge re-planning. Crucially, members get **booking
cashback/credits funded out of Pillar 1** — a flywheel: members book more → we earn
more commission → we can afford to give some back → members stay.

### Pillar 3 — B2B, data & partnerships (margin + moat)

- **Sponsored family venues & hotels** — clearly labeled, relevance-gated placements
  in recommendations (CPC/CPM or flat). Native to a recommender; the data model
  already ranks venues.
- **License the family-logistics dataset** — nap-aware tags, changing-table /
  stroller / kids-menu signals, and the aggregated *consented* review signal
  (`npm run export:feedback`) — to hotels, tourism boards (CVBs), and family brands.
- **White-label the planner** — "plan your family stay" for a hotel group, airline,
  or theme park, behind their brand.

Tourism boards and family brands pay for qualified, in-market family demand — and
this is exactly the audience Triperly aggregates.

---

## Unit economics

| Metric | Value | Source |
|---|---|---|
| Marginal cost per AI plan | **~$0.024** (Claude Sonnet 4.6, prompt cached) | README "Why Sonnet 4.6" |
| Re-plan cost for a power user | a few cents / month | same |
| **Implication** | COGS is ~zero. The constraint is **acquisition + book-through**, not serving cost — which is exactly what commission funds. |

**Illustrative "one booked family weekend":**

```
Hotel (2 nights ~$220/nt)   $440  → ~5%  = $22.00
Attraction tickets (family) $180  → ~8%  = $14.40
Dinner reservations (x2)    seats →        $1.50
Rideshare (a few hops)      $60   → ~5%  = $3.00
                                   ─────────────
Gross commission / booked trip      ≈ $40   (vs. $9.99 for a month that then churns)
AI cost to produce the plan          $0.024
```

One booked trip ≈ four months of the old subscription — and it came from a user who
paid nothing and never had to subscribe.

---

## Go-to-market (keep what works, monetize more of it)

- Keep the deck's plan: **start in small Facebook parent groups, expand to social +
  influencer partnerships.** It's cheap and perfectly on-target for parents.
- The change: every acquired free user is now monetizable via commission, so CAC
  payback **no longer depends on subscription conversion** — it depends on book-through,
  which is far higher than 2–5%.

---

## What to change in the deck

1. Rename the slide from *"$9.99/mo subscription"* to **"Free to plan — we earn when
   you book."**
2. Show the **three pillars** (commission • membership • B2B) with commission as the hero.
3. Replace the single price with the **Trip Pass / Annual / Monthly** ladder
   (annual = default).
4. Add the **per-booked-trip economics** above next to the **~$0.024** plan cost — the
   contrast is the story.
5. Add one **moat** line: the curated family-logistics data + consented reviews are
   licensable and hard to copy.

---

## Product work this implies (small, the rails exist)

- Flip the booking seam from demo to real: swap `simulateBooking()` in
  `lib/bookings.js` for affiliate/provider calls behind each provider's env key, set
  `DEMO_BOOKINGS=0` (placeholders already in `render.yaml` / `.env.example`).
- Add affiliate-link attribution (tag the existing Uber / Google Flights / OpenTable
  deep links).
- Add the membership ladder + a booking-cashback ledger (Stripe/RevenueCat, already on
  the roadmap).
- Add a labeled "Sponsored" slot to the recommendation list.

> Figures here are illustrative industry ranges for modeling, not commitments. Validate
> commission rates with each partner program before putting them in front of investors.
