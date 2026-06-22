// lib/transport.js
// Door-to-door transport for the itinerary: estimate a travel "leg" between two
// places (stop↔stop, hotel↔stop, airport↔hotel) and build real, free deep links
// so every "book a ride / buy a ticket / get directions" button goes somewhere.
//
// Everything here is deterministic and network-free:
//   • distance — haversine when both ends have coordinates (Places venues, or the
//     lib/geo.js overlay for seed data); otherwise a stable neighborhood heuristic
//     so any city still works with no coordinates and no key.
//   • per-mode time + cost — simple city-speed/fare models, rounded to tidy demo
//     numbers and seeded so they don't jitter between reloads.
//   • deep links — Uber universal links (lat/lng + formatted address) and Google
//     Maps directions (transit / driving / walking). Both resolve with or without
//     coordinates.
//
// No real prices are charged; estimates are clearly labeled in the UI.

import { VENUE_GEO, HOTEL_GEO, airportFor } from "./geo.js";

// --- coordinates -------------------------------------------------------------

// Resolve {lat,lng} for a place: its own coords (Places) → seed overlay → none.
function coordsOf(place) {
  if (!place) return null;
  if (typeof place.lat === "number" && typeof place.lng === "number")
    return { lat: place.lat, lng: place.lng };
  if (place.id && VENUE_GEO[place.id]) return { lat: VENUE_GEO[place.id][0], lng: VENUE_GEO[place.id][1] };
  if (place.name && HOTEL_GEO[place.name]) return { lat: HOTEL_GEO[place.name][0], lng: HOTEL_GEO[place.name][1] };
  return null;
}

function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Stable pseudo-random in [0,1) from a string (FNV-1a), so heuristic distances
// and any jitter stay identical across requests/reloads for the same pair.
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

// Distance in km. Uses real coordinates when available; otherwise estimates from
// whether the two places share a neighborhood "area", with a stable jitter.
function distanceKm(from, to) {
  const a = coordsOf(from), b = coordsOf(to);
  if (a && b) return haversineKm(a, b);
  const same = from.area && to.area && from.area === to.area;
  const jit = seeded(`${from.name || ""}→${to.name || ""}`);
  return +((same ? 0.9 + jit * 1.2 : 4.5 + jit * 5).toFixed(2));
}

// --- time + cost models ------------------------------------------------------

// Minutes per km by mode + a fixed overhead (rideshare wait, transit walk/wait,
// parking). Tuned to feel like dense-city travel with young kids.
const MIN_PER_KM = { walk: 12.5, ride: 3.0, transit: 5.2, drive: 3.3 };
const OVERHEAD_MIN = { walk: 0, ride: 4, transit: 7, drive: 3 };
function minutesFor(mode, km) {
  return Math.max(1, Math.round(OVERHEAD_MIN[mode] + km * MIN_PER_KM[mode]));
}

// Rideshare fare: base + per-km + per-min, floored, rounded to $0.50.
function rideCostCents(km, mins) {
  const c = 250 + km * 145 + mins * 30;
  return Math.max(800, Math.round(c / 50) * 50);
}
const TRANSIT_FARE_CENTS = 275; // one adult fare (demo flat rate)

const dollars = (cents) => "$" + (cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2));

// --- deep links --------------------------------------------------------------

function placeAddress(p) {
  return [p.name, p.city].filter(Boolean).join(", ");
}

// Uber universal link with pickup/dropoff. Sets lat/lng when known and always a
// formatted address + nickname, so the link resolves with or without coords.
export function uberLink(from, to) {
  const a = coordsOf(from), b = coordsOf(to);
  const p = new URLSearchParams();
  p.set("action", "setPickup");
  if (a) { p.set("pickup[latitude]", String(a.lat)); p.set("pickup[longitude]", String(a.lng)); }
  p.set("pickup[nickname]", from.name || "Pickup");
  p.set("pickup[formatted_address]", placeAddress(from));
  if (b) { p.set("dropoff[latitude]", String(b.lat)); p.set("dropoff[longitude]", String(b.lng)); }
  p.set("dropoff[nickname]", to.name || "Destination");
  p.set("dropoff[formatted_address]", placeAddress(to));
  return "https://m.uber.com/ul/?" + p.toString();
}

// Google Maps directions in a given travel mode. Uses coordinates when present
// (precise pins), else the "Name, City" string (Google resolves the venue).
export function mapsDirections(from, to, travelmode) {
  const a = coordsOf(from), b = coordsOf(to);
  const p = new URLSearchParams({
    api: "1",
    origin: a ? `${a.lat},${a.lng}` : placeAddress(from),
    destination: b ? `${b.lat},${b.lng}` : placeAddress(to),
    travelmode,
  });
  return "https://www.google.com/maps/dir/?" + p.toString();
}

// --- legs --------------------------------------------------------------------

// Build the set of transport options between two places. Returns every viable
// mode (so the front-end can let the family switch and No-walking mode can avoid
// walking with no recompute) plus a recommended pick for normal and no-walk.
export function legBetween(from, to) {
  const km = distanceKm(from, to);
  const walkMin = minutesFor("walk", km);
  const rideMin = minutesFor("ride", km);
  const rideCost = rideCostCents(km, rideMin);
  const transitMin = minutesFor("transit", km);
  const driveMin = minutesFor("drive", km);

  const modes = {
    walk: { type: "walk", label: "Walk", provider: null, mins: walkMin, costCents: 0, cost: "Free", bookable: false, deepLink: mapsDirections(from, to, "walking") },
    ride: { type: "ride", label: "Rideshare", provider: "Uber", mins: rideMin, costCents: rideCost, cost: dollars(rideCost), bookable: true, kind: "ride", deepLink: uberLink(from, to) },
    transit: { type: "transit", label: "Transit", provider: "Transit", mins: transitMin, costCents: TRANSIT_FARE_CENTS, cost: dollars(TRANSIT_FARE_CENTS), bookable: true, kind: "transit", deepLink: mapsDirections(from, to, "transit") },
    drive: { type: "drive", label: "Drive", provider: null, mins: driveMin, costCents: 0, cost: "Your car", bookable: false, deepLink: mapsDirections(from, to, "driving") },
  };

  // Normal: walk short hops, ride medium, transit when far. No-walk: never walk.
  const pick = walkMin <= 9 ? "walk" : km <= 9 ? "ride" : "transit";
  const pickNoWalk = km <= 2.2 ? "ride" : "transit";

  return {
    from: from.name, to: to.name,
    km: +km.toFixed(2),
    miles: +(km * 0.621371).toFixed(1),
    walkMin,
    modes, pick, pickNoWalk,
  };
}

// --- attach to a plan --------------------------------------------------------

// A "place" the leg model understands, built from a stop name via the dataset.
function venuePlace(name, byName, city) {
  const v = byName.get(name);
  return v
    ? { name: v.name, id: v.id, area: v.area, lat: v.lat, lng: v.lng, city }
    : { name, city };
}
function hotelPlace(hotel, city) {
  return hotel ? { name: hotel.name, area: hotel.area, lat: hotel.lat, lng: hotel.lng, city } : null;
}
function airportPlace(airport) {
  return airport ? { name: `${airport.name} (${airport.code})`, code: airport.code, lat: airport.lat, lng: airport.lng } : null;
}

// Enrich a built plan (rules or AI engine) with transport, in place:
//   • stops[i].leg     — travel from this stop to the next
//   • day.startLeg     — base hotel → first stop of the day
//   • day.endLeg       — last stop of the day → base hotel
//   • plan.arrival     — airport → base hotel  (and plan.departure, the reverse)
//   • plan.baseHotel / plan.airport — context for the UI
// Degrades gracefully: stop legs always work; hotel legs need a hotel; airport
// legs need a known city airport. Never throws.
export function attachTripTransport(plan, data) {
  if (!plan || !Array.isArray(plan.days) || !plan.days.length) return plan;
  const city = plan.city || data.city || "";
  const byName = new Map((data.venues || []).map((v) => [v.name, v]));
  const baseHotel = (plan.hotels && plan.hotels[0]) || (data.hotels && data.hotels[0]) || null;
  const basePlace = hotelPlace(baseHotel, city);
  const airport = airportFor(city);
  const apPlace = airportPlace(airport);

  for (const day of plan.days) {
    const stops = day.stops || [];
    for (let i = 0; i < stops.length - 1; i++) {
      stops[i].leg = legBetween(venuePlace(stops[i].name, byName, city), venuePlace(stops[i + 1].name, byName, city));
    }
    if (stops.length && stops[stops.length - 1]) delete stops[stops.length - 1].leg;
    if (basePlace && stops.length) {
      day.startLeg = legBetween(basePlace, venuePlace(stops[0].name, byName, city));
      day.endLeg = legBetween(venuePlace(stops[stops.length - 1].name, byName, city), basePlace);
    }
  }

  if (basePlace) plan.baseHotel = { name: baseHotel.name, area: baseHotel.area || "" };
  if (apPlace) {
    plan.airport = { code: airport.code, name: airport.name };
    if (basePlace) {
      plan.arrival = legBetween(apPlace, basePlace);
      plan.departure = legBetween(basePlace, apPlace);
    }
  }
  return plan;
}
