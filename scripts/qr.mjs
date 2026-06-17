// scripts/qr.mjs
// Generate a QR code that points at your deployed TripIt URL.
//
//   npm run qr -- https://your-app.onrender.com
//
// Prints a scannable QR in the terminal and writes image files you can drop
// into a slide, poster, or flyer:
//   public/qr.png  (800px, for slides/printing)
//   public/qr.svg  (vector, crisp at any size)

import QRCode from "qrcode";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const url = process.argv[2];

if (!url || !/^https?:\/\//i.test(url)) {
  console.error("\nUsage:  npm run qr -- <your-public-url>");
  console.error("Example: npm run qr -- https://tripit.onrender.com");
  console.error("(the URL must start with http:// or https://)\n");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
await mkdir(dir, { recursive: true });
const pngPath = path.join(dir, "qr.png");
const svgPath = path.join(dir, "qr.svg");

const colors = { dark: "#06131f", light: "#ffffff" }; // high-contrast, scans reliably

// 1) Terminal preview — this block is itself scannable with a phone camera.
console.log("\nScan to open TripIt on your phone:\n");
console.log(await QRCode.toString(url, { type: "terminal", small: true, errorCorrectionLevel: "M" }));

// 2) Image files for decks / printing / sharing.
await QRCode.toFile(pngPath, url, { width: 800, margin: 2, color: colors });
await writeFile(svgPath, await QRCode.toString(url, { type: "svg", margin: 2, color: colors }));

const rel = (p) => path.relative(process.cwd(), p);
console.log(`Pointing at:  ${url}\n`);
console.log("Saved:");
console.log(`  ${rel(pngPath)}   (800px PNG — slides & printing)`);
console.log(`  ${rel(svgPath)}   (SVG — crisp at any size)\n`);
console.log("Tip: re-run this any time your URL changes.\n");
