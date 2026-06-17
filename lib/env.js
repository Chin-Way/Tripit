// lib/env.js
// Tiny zero-dependency .env loader. Reads KEY=VALUE lines from a .env file (if
// present) into process.env, without overwriting variables already set by the
// host. So locally you can keep keys in a .env file; on Render/etc. the
// dashboard-provided env vars take precedence.
import { readFileSync } from "node:fs";

export function loadEnv(file = ".env") {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return; // no .env file — that's fine
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][\w.-]*)\s*=\s*(.*)?$/);
    if (!m) continue; // skip blanks and # comment lines
    const key = m[1];
    let val = (m[2] || "").trim();
    const quoted = (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"));
    if (quoted) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(" #"); // strip trailing inline comment on unquoted values
      if (hash >= 0) val = val.slice(0, hash).trim();
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
