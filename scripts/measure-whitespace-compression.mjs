#!/usr/bin/env node
// Evidence for the "preserved template indentation" size question.
//
// Renders the representative site fixture natively, derives an
// indentation-free reference by trimming leading whitespace on template-owned
// lines, and reports raw / gzip / Brotli sizes of both. Measurement only; this
// is not a minifier, is never used for output and asserts nothing.
//
//   node scripts/measure-whitespace-compression.mjs
import { execFileSync } from "node:child_process";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const render = (paragraphs, navItems) =>
  execFileSync(
    "cargo",
    [
      "run",
      "--release",
      "--locked",
      "--quiet",
      "-p",
      "flowview-compiler",
      "--example",
      "render_sample",
      "--",
      String(paragraphs),
      String(navItems),
    ],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

// Proxy for a renderer whose source carries no readable indentation. The
// sample contains no <pre>, <textarea> or inline-significant whitespace on the
// lines that are trimmed, so this is only a size proxy, not a safe transform.
const indentFree = (html) =>
  html
    .split("\n")
    .map((line) => line.trimStart())
    .filter((line) => line.length > 0)
    .join("\n");

const gzip = (text) => gzipSync(text, { level: 9 }).length;
const brotli = (text) =>
  brotliCompressSync(text, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
const bytes = (text) => Buffer.byteLength(text);
const pct = (a, b) => `${(((a - b) / b) * 100).toFixed(1)}%`;

const scenarios = [
  ["body-heavy: 40 paragraphs, 12 nav items", 40, 12],
  ["template-heavy: 4 paragraphs, 60 nav items", 4, 60],
];

for (const [label, paragraphs, navItems] of scenarios) {
  const html = render(paragraphs, navItems);
  const reference = indentFree(html);
  const rows = [
    ["raw", bytes(html), bytes(reference)],
    ["gzip -9", gzip(html), gzip(reference)],
    ["brotli q11", brotli(html), brotli(reference)],
  ];
  console.log(`\n${label}`);
  console.log("encoding     flowview  indent-free  delta");
  for (const [name, a, b] of rows) {
    console.log(
      `${name.padEnd(12)} ${String(a).padStart(8)}  ${String(b).padStart(11)}  ${pct(a, b)}`,
    );
  }
}
