// lib/wallet.js
// Apple Wallet passes for reservations — the Wallet analog of DEMO_BOOKINGS.
//
// A real, installable .pkpass is a signed bundle: iOS rejects unsigned passes,
// and signing needs an Apple Developer "Pass Type ID" certificate (PKCS#7).
// So by default we SIMULATE: this module produces a structured "pass descriptor"
// that the front-end renders as an in-app Apple Wallet pass (clearly labeled
// demo), and the "Add to Apple Wallet" tap is recorded client-side.
//
// Real passes are an approval-gated phase 2 (like real booking providers and
// native social posting): when APPLE_PASS_* certs are configured, buildPass()'s
// descriptor is the same shape you'd serialize into pass.json and sign — wire
// the signer in lib/api/wallet.js where noted, and set DEMO_WALLET=0.

export const demoWalletEnabled = () =>
  !["0", "false", "no", "off"].includes(String(process.env.DEMO_WALLET ?? "1").toLowerCase());

// True when a real Pass Type ID cert + key are configured (phase 2).
export const realPassConfigured = () =>
  !!(process.env.APPLE_PASS_TYPE_ID && process.env.APPLE_TEAM_ID &&
     process.env.APPLE_PASS_CERT && process.env.APPLE_PASS_KEY);

export function walletConfig() {
  const real = realPassConfigured();
  return { enabled: demoWalletEnabled() || real, real, demo: demoWalletEnabled() && !real };
}

// Booking kind → pass style + accent (accent names map to the front-end palette).
const KIND = {
  flight: { label: "Flight", accent: "blue", style: "boardingPass" },
  hotel: { label: "Hotel stay", accent: "teal", style: "generic" },
  restaurant: { label: "Restaurant", accent: "amber", style: "eventTicket" },
  ride: { label: "Rideshare", accent: "purple", style: "generic" },
  transit: { label: "Transit", accent: "green", style: "generic" },
  car: { label: "Drive", accent: "blue", style: "generic" },
};

const head = (s, sep = "·") => String(s || "").split(sep)[0].trim();
const money = (c) => "$" + (((c || 0) % 100 === 0) ? (c || 0) / 100 : ((c || 0) / 100).toFixed(2));

// Build the pass descriptor for a booking. Shared by the in-app preview today and
// by the real .pkpass serializer in phase 2 (same fields → pass.json).
export function buildPass(b = {}) {
  const k = KIND[b.kind] || KIND.ride;
  let fields;
  if (b.kind === "flight") {
    fields = [{ label: "ROUTE", value: head(b.subtitle) || "—" }, { label: "WHEN", value: b.time || "—" }];
  } else if (b.kind === "hotel") {
    fields = [{ label: "CHECK-IN", value: String(b.time || "").replace(/^Check-in\s*·\s*/i, "") || "—" }, { label: "DETAILS", value: head(b.subtitle) || "—" }];
  } else if (b.kind === "restaurant") {
    fields = [{ label: "PARTY", value: head(b.subtitle) || "Table" }, { label: "TIME", value: b.time || "—" }];
  } else {
    fields = [{ label: "PICKUP", value: String(b.time || "").replace(/^Pickup\s*/i, "") || "—" }, { label: "FARE", value: b.costCents ? money(b.costCents) : "—" }];
  }
  return {
    org: "Triperly",
    kindLabel: k.label,
    accent: k.accent,
    style: k.style,
    hero: b.title || k.label,
    sub: b.city || "",
    fields,
    barcode: b.confirmation || "TF-DEMO",
    demo: true,
  };
}
