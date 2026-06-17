// lib/places.js
// Live venue data from the Google Places API (New). When GOOGLE_PLACES_API_KEY
// is set, this replaces the seed data/chicago.json with real places (real
// ratings, locations, and some kid attributes), mapped into TripIt's venue
// schema so the rules/AI engines work unchanged.
//
// Honest note: Places gives the *facts* (rating, location, opening info, and a
// few kid signals like goodForChildren / menuForChildren / wheelchair access).
// The deep family-logistics tags (nap-timing, changing tables) are still partly
// derived heuristically here — that curation is TripIt's value-add, and is where
// a human-vetted overlay would eventually live.
//
// Verified against the Places API (New) Text Search REST shape:
//   POST https://places.googleapis.com/v1/places:searchText
//   headers: X-Goog-Api-Key, X-Goog-FieldMask, Content-Type: application/json
//   body: { textQuery, maxResultCount, languageCode }

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// Atmosphere fields (goodForChildren/menuForChildren/restroom/goodForGroups) are
// billed at a higher SKU — kept to one field mask, one set of queries, cached.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.types",
  "places.primaryType",
  "places.goodForChildren",
  "places.menuForChildren",
  "places.restroom",
  "places.accessibilityOptions",
  "places.goodForGroups",
].join(",");

// A small, fixed query set per city keeps cost predictable while giving variety.
const QUERIES = (city) => [
  `top family attractions in ${city}`,
  `best museums for kids in ${city}`,
  `parks and playgrounds in ${city}`,
  `family friendly restaurants with kids menu in ${city}`,
];

const PRICE = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

// types/primaryType -> our category + tile icon + accent color.
function classify(place) {
  const t = new Set([place.primaryType, ...(place.types || [])].filter(Boolean));
  const has = (...keys) => keys.some((k) => t.has(k));
  if (has("zoo")) return { category: "zoo", icon: "paw", color: "blue", outdoor: true };
  if (has("aquarium")) return { category: "museum", icon: "fish", color: "blue", indoor: true };
  if (has("museum", "art_gallery")) return { category: "museum", icon: "museum", color: "purple", indoor: true };
  if (has("amusement_park")) return { category: "landmark", icon: "wheel", color: "green", outdoor: true };
  if (has("park", "national_park", "garden", "playground", "botanical_garden"))
    return { category: "park", icon: "tree", color: "green", outdoor: true };
  if (has("beach")) return { category: "water", icon: "boat", color: "blue", outdoor: true };
  if (has("restaurant", "cafe", "bakery", "meal_takeaway", "meal_delivery", "food", "diner"))
    return { category: "food", icon: "fork", color: "amber", meal: true };
  if (has("tourist_attraction", "landmark", "point_of_interest"))
    return { category: "landmark", icon: "star", color: "purple", outdoor: true };
  return { category: "landmark", icon: "star", color: "teal" };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const DURATION = { museum: 150, zoo: 120, park: 75, landmark: 60, water: 90, food: 60 };

// Round lat/lng into a ~1km grid cell so the engine can group "nearby" stops.
function areaKey(loc) {
  if (!loc) return "central";
  return `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}`;
}

function toVenue(place) {
  if (!place.displayName?.text || !place.location || typeof place.rating !== "number") return null;
  if ((place.userRatingCount || 0) < 50) return null; // quality floor

  const c = classify(place);
  const tags = [];
  if (place.accessibilityOptions?.wheelchairAccessibleEntrance) tags.push("stroller");
  if (c.indoor) tags.push("indoor");
  if (c.outdoor) tags.push("outdoor");
  if (place.priceLevel === "PRICE_LEVEL_FREE" || (c.category === "park" && !place.priceLevel)) tags.push("free");
  if (c.meal && (place.menuForChildren || place.goodForChildren)) {
    tags.push("kidmenu");
    tags.push("highchair");
  }
  const napFriendly = ["park", "landmark", "water"].includes(c.category);
  if (napFriendly) tags.push("naptimed");

  const priceSym = PRICE[place.priceLevel] || "";
  const meta = [priceSym, cap(c.category)].filter(Boolean).join(" · ");

  const hl = {};
  if (tags.includes("stroller")) hl.stroller = "Listed as wheelchair-accessible — easy with a stroller.";
  if (tags.includes("kidmenu")) hl.kidmenu = "Google lists a children's menu here.";
  if (tags.includes("indoor")) hl.indoor = "Indoor — a reliable rainy-day option.";
  if (tags.includes("free")) hl.free = "Free to visit — an easy, low-pressure stop.";
  if (tags.includes("naptimed")) hl.naptimed = "Calm and stroller-smooth — good for the nap window.";

  const kidNote = place.goodForChildren ? " and Google flags it as good for kids" : "";
  return {
    id: place.id,
    name: place.displayName.text,
    icon: c.icon,
    color: c.color,
    area: areaKey(place.location),
    lat: place.location.latitude,
    lng: place.location.longitude,
    meta,
    price: priceSym,
    rating: place.rating,
    count: place.userRatingCount || 0,
    category: c.category,
    durationMins: DURATION[c.category] || 90,
    tags: [...new Set(tags)],
    napFriendly,
    meal: !!c.meal,
    why: `Rated ${place.rating.toFixed(1)} by ${(place.userRatingCount || 0).toLocaleString()} visitors${kidNote}.`,
    hl,
  };
}

async function searchText(query, apiKey) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 20, languageCode: "en" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.places || [];
}

// Fetch and map venues for a city. Throws on hard failure (e.g. bad key) so the
// caller can fall back to seed data.
export async function getVenues(city, apiKey) {
  const byId = new Map();
  let firstError = null;
  for (const q of QUERIES(city)) {
    try {
      for (const p of await searchText(q, apiKey)) {
        if (!byId.has(p.id)) byId.set(p.id, p);
      }
    } catch (err) {
      firstError = firstError || err; // tolerate a single failing query
    }
  }
  const venues = [...byId.values()].map(toVenue).filter(Boolean);
  // sort by popularity so the most-reviewed places lead; engine re-scores anyway
  venues.sort((a, b) => b.count - a.count);
  if (!venues.length) throw firstError || new Error("Places returned no usable venues");
  return venues.slice(0, 24);
}
