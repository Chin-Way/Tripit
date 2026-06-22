// lib/geo.js
// Demo geo overlay for the transport layer.
//
// The seed datasets in data/*.json describe venues by name + neighborhood
// "area" but carry no coordinates (only Google Places-sourced venues do, via
// lib/places.js). lib/transport.js needs lat/lng to estimate distances and to
// build precise Uber / Google Maps deep links, so we keep approximate
// coordinates for the seeded venues, hotels, and each city's main airport here,
// in one reviewable place — instead of bloating every data file.
//
// Resolution order in transport.js: a venue's own lat/lng (Places) wins; then
// this overlay (keyed by the seed venue `id` or the hotel `name`); then a
// neighborhood-based heuristic, so any city still works with no coordinates.
//
// Coordinates are approximate (good to a few hundred metres) — fine for demo
// estimates and for dropping a rideshare/Maps pin on the right block.

// Seed venue coordinates, keyed by the `id` used in data/*.json.
export const VENUE_GEO = {
  // --- Chicago ---
  "lincoln-park-zoo": [41.9216, -87.6337],
  "lou-malnatis": [41.8905, -87.6340],
  "navy-pier": [41.8917, -87.6086],
  "millennium-park": [41.8826, -87.6226],
  "shedd-aquarium": [41.8676, -87.6140],
  "maggie-daley-park": [41.8837, -87.6195],
  "field-museum": [41.8663, -87.6170],
  "msi": [41.7906, -87.5831],
  "lincoln-park-conservatory": [41.9242, -87.6354],
  "art-institute": [41.8796, -87.6237],
  "childrens-museum": [41.8919, -87.6051],
  "north-ave-beach": [41.9114, -87.6266],
  "riverwalk": [41.8881, -87.6240],
  "portillos": [41.8932, -87.6313],
  "eataly": [41.8923, -87.6276],
  "garfield-conservatory": [41.8864, -87.7172],

  // --- San Diego ---
  "sd-zoo": [32.7353, -117.1490],
  "sd-balboa-park": [32.7341, -117.1446],
  "sd-birch-aquarium": [32.8657, -117.2516],
  "sd-uss-midway": [32.7137, -117.1751],
  "sd-la-jolla-cove": [32.8508, -117.2713],
  "sd-new-childrens-museum": [32.7095, -117.1632],
  "sd-seaport-village": [32.7095, -117.1709],
  "sd-coronado-beach": [32.6859, -117.1831],
  "sd-hodads": [32.7497, -117.2492],
  "sd-old-town-cafe": [32.7549, -117.1976],
  "sd-pizzeria-luigi": [32.7480, -117.1300],

  // --- New York ---
  "ny-central-park": [40.7829, -73.9654],
  "ny-amnh": [40.7813, -73.9740],
  "ny-bronx-zoo": [40.8506, -73.8769],
  "ny-brooklyn-bridge-park": [40.7003, -73.9967],
  "ny-high-line": [40.7480, -74.0048],
  "ny-intrepid": [40.7645, -74.0009],
  "ny-cmom": [40.7860, -73.9760],
  "ny-battery-park": [40.7033, -74.0170],
  "ny-juniors": [40.7575, -73.9857],
  "ny-joes-pizza": [40.7305, -74.0027],
  "ny-shake-shack": [40.7414, -73.9882],

  // --- San Francisco ---
  "sf-cal-academy": [37.7699, -122.4661],
  "sf-exploratorium": [37.8017, -122.3973],
  "sf-golden-gate-park": [37.7694, -122.4862],
  "sf-zoo": [37.7325, -122.5030],
  "sf-pier-39": [37.8087, -122.4098],
  "sf-crissy-field": [37.8040, -122.4650],
  "sf-aquarium-bay": [37.8085, -122.4096],
  "sf-creativity-museum": [37.7850, -122.4030],
  "sf-mels": [37.7850, -122.4290],
  "sf-tonys-pizza": [37.8001, -122.4090],
  "sf-ghirardelli": [37.8058, -122.4229],

  // --- Washington DC ---
  "dc-air-space": [38.8882, -77.0199],
  "dc-natural-history": [38.8913, -77.0260],
  "dc-zoo": [38.9296, -77.0497],
  "dc-national-mall": [38.8895, -77.0353],
  "dc-american-history": [38.8911, -77.0300],
  "dc-botanic-garden": [38.8884, -77.0133],
  "dc-tidal-basin": [38.8870, -77.0410],
  "dc-spy-museum": [38.8845, -77.0254],
  "dc-and-pizza": [38.8975, -77.0212],
  "dc-shake-shack": [38.9100, -77.0430],
  "dc-old-ebbitt": [38.8978, -77.0337],
};

// Seed hotel coordinates, keyed by the hotel `name` in data/*.json.
export const HOTEL_GEO = {
  // Chicago
  "Loews Chicago Hotel": [41.8902, -87.6213],
  "Embassy Suites by Hilton Downtown Mag Mile": [41.8907, -87.6204],
  "Sheraton Grand Chicago Riverwalk": [41.8893, -87.6195],
  "Hyatt Regency Chicago": [41.8874, -87.6219],
  // San Diego
  "Hotel del Coronado": [32.6809, -117.1784],
  "Hyatt Regency Mission Bay": [32.7700, -117.2350],
  "Paradise Point Resort": [32.7795, -117.2380],
  "Embassy Suites San Diego Bay Downtown": [32.7157, -117.1690],
  // New York
  "Hotel Beacon": [40.7806, -73.9810],
  "Embassy Suites by Hilton Manhattan Times Square": [40.7510, -73.9860],
  "Hyatt Place New York/Midtown-South": [40.7450, -73.9890],
  "The Manhattan at Times Square": [40.7637, -73.9817],
  // San Francisco
  "Argonaut Hotel": [37.8077, -122.4203],
  "Hyatt Regency San Francisco": [37.7945, -122.3940],
  "Hotel Zephyr Fisherman's Wharf": [37.8079, -122.4135],
  "Hilton San Francisco Union Square": [37.7860, -122.4100],
  // Washington DC
  "Embassy Suites by Hilton Washington DC Convention Center": [38.9015, -77.0258],
  "Hyatt Regency Washington on Capitol Hill": [38.8932, -77.0110],
  "Residence Inn Washington Downtown": [38.9046, -77.0322],
  "Marriott Marquis Washington DC": [38.9013, -77.0228],
};

// Main arrival airport per seed city, keyed by lowercased city name. Used for
// the simulated arrival/departure flights and the airport↔hotel transfer.
export const AIRPORTS = {
  "chicago": { code: "ORD", name: "O'Hare International", lat: 41.9742, lng: -87.9073 },
  "san diego": { code: "SAN", name: "San Diego International", lat: 32.7338, lng: -117.1933 },
  "new york": { code: "JFK", name: "John F. Kennedy International", lat: 40.6413, lng: -73.7781 },
  "san francisco": { code: "SFO", name: "San Francisco International", lat: 37.6213, lng: -122.3790 },
  "washington dc": { code: "DCA", name: "Reagan National", lat: 38.8512, lng: -77.0402 },
};

// Look up the main airport for a city name (case/whitespace tolerant).
export function airportFor(city) {
  const key = String(city || "").trim().toLowerCase();
  return AIRPORTS[key] || null;
}
