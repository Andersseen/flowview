import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import oniguruma from "vscode-oniguruma";
import textmate from "vscode-textmate";

const { loadWASM, OnigScanner, OnigString } = oniguruma;
const { Registry, parseRawGrammar } = textmate;

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const wasm = await fs.readFile(
  require.resolve("vscode-oniguruma/release/onig.wasm"),
);
await loadWASM(
  wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
);

const grammarPaths = new Map([
  [
    "source.flowmark",
    path.join(packageRoot, "syntaxes/flowmark.tmLanguage.json"),
  ],
]);

const registry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new OnigScanner(patterns),
    createOnigString: (value) => new OnigString(value),
  }),
  async loadGrammar(scopeName) {
    const grammarPath = grammarPaths.get(scopeName);
    if (grammarPath === undefined) {
      if (scopeName === "source.js" || scopeName === "text.html.basic") {
        return parseRawGrammar(
          JSON.stringify({ scopeName, patterns: [] }),
          `${scopeName}.json`,
        );
      }
      return null;
    }
    return parseRawGrammar(await fs.readFile(grammarPath, "utf8"), grammarPath);
  },
});

const grammar = await registry.loadGrammar("source.flowmark");
assert.ok(grammar, "Flowmark grammar must load");

const samples = [
  "@if (ctx.visible) {",
  "} @else if (ctx.pending) {",
  "} @else {",
  "@for (product of ctx.products; track product.id) {",
  "} @empty {",
  "@switch (product.status) {",
  "@case ('available') {",
  "@default {",
  "<h1>{{ ctx.title }}</h1>",
];

const scopes = samples.flatMap((line) =>
  grammar.tokenizeLine(line).tokens.flatMap((token) => token.scopes),
);

assert.ok(
  scopes.includes("keyword.control.flowmark"),
  "control keywords need a theme-compatible scope",
);
assert.ok(
  scopes.includes("keyword.operator.word.flowmark"),
  "of/track operators need their own scope",
);
assert.ok(
  scopes.includes("meta.interpolation.flowmark"),
  "interpolations need an embedded scope",
);
assert.ok(
  scopes.includes("punctuation.section.embedded.begin.flowmark"),
  "interpolation delimiters need punctuation scopes",
);

const injection = JSON.parse(
  await fs.readFile(
    path.join(packageRoot, "syntaxes/flowmark-astro-injection.tmLanguage.json"),
    "utf8",
  ),
);
assert.equal(injection.injectTo, undefined);
assert.match(injection.patterns[0].begin, /flowmark/);
assert.equal(injection.patterns[0].patterns[0].include, "source.flowmark");
const astroBegin = new RegExp(injection.patterns[0].begin);
assert.match(
  "<template flowmark is:raw context={context}>",
  astroBegin,
  "the canonical Astro wrapper must activate Flowmark highlighting",
);
assert.match(
  "<template flowmark is:raw context={{ items: source.filter((item) => item.visible) }}>",
  astroBegin,
  "braced context expressions may contain arrow functions",
);
assert.doesNotMatch(
  "<template-card flowmark>",
  astroBegin,
  "similarly named Astro components must not activate Flowmark highlighting",
);

console.log("Flowmark TextMate grammar checks passed.");
