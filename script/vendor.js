const fs = require("fs"), path = require("path");
const out = path.join(__dirname, "..", "vendor");
fs.mkdirSync(out, { recursive: true });
const nm = path.join(__dirname, "..", "node_modules");
const files = [
  ["pdfjs-dist/build/pdf.min.js", "pdf.min.js"],
  ["pdfjs-dist/build/pdf.worker.min.js", "pdf.worker.min.js"],
  ["@supabase/supabase-js/dist/umd/supabase.js", "supabase.js"],
];
for (const [src, dst] of files) {
  const from = path.join(nm, src);
  if (!fs.existsSync(from)) { console.error("Missing " + from + ". Run npm install first."); process.exit(1); }
  fs.copyFileSync(from, path.join(out, dst));
  console.log("copied", dst);
}
