// lib/api/wallet.js
// HTTP layer for Apple Wallet passes. Safe for everyone — no datastore needed.
//   GET  /api/wallet/config  → whether passes (and demo labeling) are on
//   POST /api/wallet/pass    → a pass descriptor the front-end renders in-app
// Real .pkpass generation + signing is the approval-gated phase 2 seam below.

import { sendJson } from "../http.js";
import { walletConfig, buildPass, realPassConfigured } from "../wallet.js";

export async function config(req, res) {
  sendJson(res, 200, walletConfig());
}

export async function pass(req, res, body) {
  if (!body || !body.kind) return sendJson(res, 400, { error: "Missing booking" });

  if (realPassConfigured()) {
    // --- Phase 2 (approval-gated) ----------------------------------------
    // Serialize buildPass(body) into pass.json, bundle icons + manifest, and
    // PKCS#7-sign with the Pass Type ID cert (APPLE_PASS_CERT/APPLE_PASS_KEY),
    // then respond with Content-Type "application/vnd.apple.pkpass" so iOS adds
    // it to Wallet. Not enabled yet — fall back to the in-app demo pass.
  }
  sendJson(res, 200, { pass: buildPass(body), demo: true });
}
