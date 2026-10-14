// Copies the shop's three fonts (Gloock, Lora, Courier Prime) into an app folder at build time,
// so the apps look right with no internet. Usage: node ../scripts/copy-fonts.js <app folder>/fonts
const fs = require("node:fs");
const path = require("node:path");
const out = path.resolve(process.argv[2] || "fonts");
fs.mkdirSync(out, { recursive: true });
const want = [
  ["@fontsource/gloock", "gloock", ["400"]],
  ["@fontsource/lora", "lora", ["400", "500", "600"]],
  ["@fontsource/courier-prime", "courier-prime", ["400", "700"]],
];
let n = 0;
for (const [pkg, slug, weights] of want) {
  const dir = path.join(path.dirname(require.resolve(pkg + "/package.json", { paths: [process.cwd()] })), "files");
  for (const w of weights) for (const sub of ["latin", "latin-ext"]) {
    const f = `${slug}-${sub}-${w}-normal.woff2`;
    if (fs.existsSync(path.join(dir, f))) { fs.copyFileSync(path.join(dir, f), path.join(out, f)); n++; }
  }
}
if (n < 6) { console.error(`Only ${n} font files found; expected at least 6.`); process.exit(1); }
console.log(`Copied ${n} font files to ${out}`);
