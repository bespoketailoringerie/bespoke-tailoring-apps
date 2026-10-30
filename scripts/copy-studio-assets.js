// Copies Post Studio's fonts and the PDF maker into its app folder at build time, so the app looks
// right and makes PDFs with no internet. Run from studio/: node ../scripts/copy-studio-assets.js app
const fs = require("node:fs");
const path = require("node:path");

const appDir = path.resolve(process.argv[2] || "app");
const mods = path.join(process.cwd(), "node_modules");
const fontsOut = path.join(appDir, "fonts");
fs.mkdirSync(fontsOut, { recursive: true });

// Package, then the CSS files fontsource ships for each weight and style the app offers.
const want = [
  ["@fontsource/gloock", ["400"]],
  ["@fontsource/lora", ["400", "400-italic", "600", "600-italic"]],
  ["@fontsource/courier-prime", ["400", "700"]],
  ["@fontsource/cormorant-garamond", ["500", "500-italic", "700"]],
  ["@fontsource/pinyon-script", ["400"]],
  ["@fontsource/oswald", ["400", "600"]],
];
let css = "/* Post Studio's fonts, copied in at build time by scripts/copy-studio-assets.js. */\n";
let files = 0;
const missing = [];
for (const [pkg, parts] of want) {
  const dir = path.join(mods, pkg);
  for (const part of parts) {
    const file = path.join(dir, part + ".css");
    if (!fs.existsSync(file)) { missing.push(`${pkg}/${part}`); continue; }
    css += fs.readFileSync(file, "utf8").replace(/url\((['"]?)\.\/files\/([^)'"]+)\1\)/g, (_m, _q, name) => {
      const from = path.join(dir, "files", name);
      if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(fontsOut, name)); files++; }
      return `url("${name}")`;
    }) + "\n";
  }
}
fs.writeFileSync(path.join(fontsOut, "fonts.css"), css);
if (missing.length) console.warn("Not found (the app uses a similar font instead): " + missing.join(", "));
if (files < 10) { console.error(`Only ${files} font files were copied; expected many more.`); process.exit(1); }
console.log(`Copied ${files} font files to ${fontsOut}`);

const pdf = path.join(mods, "jspdf", "dist", "jspdf.umd.min.js");
if (!fs.existsSync(pdf)) { console.error("jspdf.umd.min.js not found in node_modules/jspdf/dist"); process.exit(1); }
fs.copyFileSync(pdf, path.join(appDir, "jspdf.umd.min.js"));
console.log("Copied the PDF maker");
