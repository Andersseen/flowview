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
    "source.flowview",
    path.join(packageRoot, "syntaxes/flowview.tmLanguage.json"),
  ],
  [
    "flowview.astro.injection",
    path.join(packageRoot, "syntaxes/flowview-astro-injection.tmLanguage.json"),
  ],
  [
    "flowview.astro.raw.injection",
    path.join(
      packageRoot,
      "syntaxes/flowview-astro-raw-injection.tmLanguage.json",
    ),
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

const grammar = await registry.loadGrammar("source.flowview");
assert.ok(grammar, "flowview grammar must load");

const samples = [
  "@if (context.visible) {",
  "} @else if (context.pending) {",
  "} @else {",
  "@for (product of context.products; track product.id) {",
  "} @empty {",
  "@switch (product.status) {",
  "@case ('available') {",
  "@default {",
  "<h1>{{ context.title }}</h1>",
];

const scopes = samples.flatMap((line) =>
  grammar.tokenizeLine(line).tokens.flatMap((token) => token.scopes),
);

assert.ok(
  scopes.includes("keyword.control.flowview"),
  "control keywords need a theme-compatible scope",
);
assert.ok(
  scopes.includes("keyword.operator.word.flowview"),
  "of/track operators need their own scope",
);
assert.ok(
  scopes.includes("meta.interpolation.flowview"),
  "interpolations need an embedded scope",
);
assert.ok(
  scopes.includes("punctuation.section.embedded.begin.flowview"),
  "interpolation delimiters need punctuation scopes",
);

const injection = JSON.parse(
  await fs.readFile(
    path.join(packageRoot, "syntaxes/flowview-astro-injection.tmLanguage.json"),
    "utf8",
  ),
);
assert.equal(injection.injectTo, undefined);
assert.match(injection.patterns[0].begin, /flowview/);
assert.equal(injection.patterns[0].patterns[0].include, "source.flowview");
const astroBegin = new RegExp(injection.patterns[0].begin);
assert.match(
  "<template flowview is:raw context={context}>",
  astroBegin,
  "the canonical Astro wrapper must activate flowview highlighting",
);
assert.match(
  "<template flowview is:raw context={{ items: source.filter((item) => item.visible) }}>",
  astroBegin,
  "braced context expressions may contain arrow functions",
);
assert.match(
  "<template flowview={context} is:raw>",
  astroBegin,
  "the short flowview={...} wrapper must activate flowview highlighting",
);
assert.doesNotMatch(
  "<template-card flowview>",
  astroBegin,
  "similarly named Astro components must not activate flowview highlighting",
);

console.log("flowview TextMate grammar checks passed.");

const astroRegistry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new OnigScanner(patterns),
    createOnigString: (value) => new OnigString(value),
  }),
  getInjections(scopeName) {
    return scopeName === "source.astro"
      ? ["flowview.astro.injection", "flowview.astro.raw.injection"]
      : undefined;
  },
  async loadGrammar(scopeName) {
    const grammarPath = grammarPaths.get(scopeName);
    if (grammarPath !== undefined) {
      return parseRawGrammar(
        await fs.readFile(grammarPath, "utf8"),
        grammarPath,
      );
    }

    if (scopeName === "source.astro") {
      if (process.env.ASTRO_GRAMMAR_PATH) {
        return parseRawGrammar(
          await fs.readFile(process.env.ASTRO_GRAMMAR_PATH, "utf8"),
          process.env.ASTRO_GRAMMAR_PATH,
        );
      }

      return parseRawGrammar(
        JSON.stringify({
          scopeName,
          patterns: [
            {
              begin: "<([^/?!\\s<>]+)(?=[^>]+is:raw).*?",
              end: "</\\1\\s*>|/>",
              name: "meta.scope.tag.$1.astro meta.raw.astro",
              contentName: "source.unknown",
            },
          ],
        }),
        `${scopeName}.json`,
      );
    }

    if (
      scopeName === "source.js" ||
      scopeName === "source.unknown" ||
      scopeName === "text.html.basic"
    ) {
      return parseRawGrammar(
        JSON.stringify({ scopeName, patterns: [] }),
        `${scopeName}.json`,
      );
    }

    return null;
  },
});

const astroGrammar = await astroRegistry.loadGrammar("source.astro");
assert.ok(astroGrammar, "Astro host grammar must load");

let ruleStack = null;
const embeddedLines = [
  "<template flowview is:raw context={context}>",
  "  <h1>{{ context.title }}</h1>",
  "  @if (context.visible) {",
  "    <span>{{ context.label }}</span>",
  "  } @else {",
  "    <span>Hidden</span>",
  "  }",
  "</template>",
];
const embeddedScopes = [];

for (const line of embeddedLines) {
  const result = astroGrammar.tokenizeLine(line, ruleStack);
  ruleStack = result.ruleStack;
  embeddedScopes.push(...result.tokens.flatMap((token) => token.scopes));
}

assert.ok(
  embeddedScopes.includes("meta.embedded.flowview"),
  "Astro template contents must enter the flowview embedded scope",
);
assert.ok(
  embeddedScopes.includes("keyword.control.flowview"),
  "flowview keywords inside Astro must receive keyword scopes",
);
assert.ok(
  embeddedScopes.includes("meta.interpolation.flowview"),
  "flowview interpolations inside Astro must receive embedded scopes",
);

console.log("flowview Astro injection checks passed.");
