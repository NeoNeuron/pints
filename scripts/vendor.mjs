// Copies the ESM builds of our two runtime dependencies into vendor/ so the
// browser can import them directly. This is the whole "build step": a file copy.
import { copyFileSync, mkdirSync } from "node:fs";

const FILES = [
  ["node_modules/marked/lib/marked.esm.js", "vendor/marked.esm.js"],
  ["node_modules/dompurify/dist/purify.es.mjs", "vendor/purify.es.mjs"],
];

mkdirSync("vendor", { recursive: true });
for (const [from, to] of FILES) {
  copyFileSync(from, to);
  console.log(`vendored ${from} -> ${to}`);
}
