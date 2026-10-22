#!/usr/bin/env node
// Prototype-only generated-Rust candidate: embed canonical artifact bytes as
// a Rust raw byte string, then load them through the production runtime.
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  process.stderr.write(
    "usage: node scripts/aot-rust-prototype.mjs artifact.json output.rs\n",
  );
  process.exit(2);
}
const content = readFileSync(input, "utf8");
let hashes = "";
while (content.includes(`\"${hashes}`)) hashes += "#";
const literal = `br${hashes}\"${content}\"${hashes}`;
writeFileSync(
  output,
  `// Generated prototype. Do not commit measurement output.\npub static ARTIFACT: &[u8] = ${literal};\npub fn load_template() -> Result<flowview_static_runtime::Template, flowview_static_runtime::ArtifactError> {\n    flowview_static_runtime::Template::from_bytes(ARTIFACT)\n}\n`,
);
