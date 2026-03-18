#!/usr/bin/env node
// patch-esm.cjs — run after npm install to fix packages that are missing
// "type": "module" in their package.json, causing tsx to compile them as CJS
// and break ESM-only imports (e.g. @mariozechner/pi-ai).
"use strict";
const fs = require("fs");
const path = require("path");

const PACKAGES = ["pi-smart-sessions", "pi-parallel"];

for (const pkg of PACKAGES) {
  const pkgJsonPath = path.join(__dirname, "..", "node_modules", pkg, "package.json");
  try {
    const json = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (json.type !== "module") {
      json.type = "module";
      fs.writeFileSync(pkgJsonPath, JSON.stringify(json, null, 2) + "\n");
      console.log(`[patch-esm] added "type":"module" to ${pkg}`);
    }
  } catch {
    // Package not installed yet — skip silently
  }
}
