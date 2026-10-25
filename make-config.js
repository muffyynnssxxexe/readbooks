// Writes config.js from two settings the owner types into the host's dashboard:
//   SUPABASE_URL and SUPABASE_ANON_KEY  (the "anon" key is meant to be public; the data
//   is protected by the database rules in schema.sql, not by hiding this key).
// Never put the service_role key here or anywhere in the website.
const fs = require("fs"), path = require("path");
const url = process.env.SUPABASE_URL || "", key = process.env.SUPABASE_ANON_KEY || "";
if (/service_role/i.test(key) || (key.split(".")[1] && Buffer.from(key.split(".")[1], "base64").toString().includes('"service_role"'))) {
  console.error("STOP: that is the secret service_role key. Use the anon (public) key instead.");
  process.exit(1);
}
fs.writeFileSync(path.join(__dirname, "..", "config.js"),
  "window.READBOOKS_CONFIG=" + JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key }) + ";\n");
console.log("config.js written" + (url ? "" : " (EMPTY: settings not provided yet)"));
