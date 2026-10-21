import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseDocument } from "../dist/extension-core.test.mjs";

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
  translate(lines, characters) {
    return new Position(this.line + lines, this.character + characters);
  }
}
class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}
class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}
const vscode = {
  Position,
  Range,
  Diagnostic,
  DiagnosticSeverity: { Error: 0, Warning: 1 },
};

function document(source, path, languageId) {
  return {
    uri: { fsPath: path },
    languageId,
    getText: () => source,
    positionAt(offset) {
      const before = source.slice(0, offset);
      const line = before.split("\n").length - 1;
      return new Position(line, before.length - (before.lastIndexOf("\n") + 1));
    },
  };
}

// @spec SPEC-HTML-100
test("standalone diagnostics use current source and preserve compiler codes/severity", () => {
  const source = "é€漢🙂👩‍💻�\n<div>{{ }}</div>";
  const diagnostics = diagnoseDocument(
    document(source, "/tmp/page.flow", "flowview"),
    vscode,
  );
  const emptyExpression = diagnostics.find((item) => item.code === "FV0005");
  assert.ok(emptyExpression);
  assert.equal(emptyExpression.severity, vscode.DiagnosticSeverity.Error);
  assert.equal(
    source
      .split("\n")[1]
      .slice(
        emptyExpression.range.start.character,
        emptyExpression.range.end.character,
      ),
    "{{ ",
  );
  assert.ok(diagnostics.every((item) => item.source === "FlowView"));

  const warning = diagnoseDocument(
    document(
      "@for (item of context.items; track item.id) {x}",
      "/tmp/warn.flow",
      "flowview",
    ),
    vscode,
  ).find((item) => item.code === "FV0015");
  assert.ok(warning);
  assert.equal(warning.severity, vscode.DiagnosticSeverity.Warning);
});

// @spec SPEC-HTML-101
test("Astro diagnostics map errors from multiple regions into host ranges", () => {
  const source = `---\nconst context = {};\n---\n<p>é🙂</p>\n<template flowview is:raw context={context}>{{ }}</template>\n<template flowview={context} is:raw>@if () {x}</template>`;
  const diagnostics = diagnoseDocument(
    document(source, "/tmp/Page.astro", "astro"),
    vscode,
  );
  const emptyInterpolation = diagnostics.find((item) => item.code === "FV0005");
  const emptyCondition = diagnostics.find((item) => item.code === "FV0007");
  assert.ok(emptyInterpolation);
  assert.ok(emptyCondition);
  assert.equal(
    source.slice(source.indexOf("{{ "), source.indexOf("{{ ") + 3),
    "{{ ",
  );
  assert.equal(emptyInterpolation.range.start.line, 4);
  assert.equal(emptyCondition.range.start.line, 5);

  const withoutRegions = diagnoseDocument(
    document("<main>plain Astro</main>", "/tmp/Page.astro", "astro"),
    vscode,
  );
  assert.deepEqual(withoutRegions, []);
});

// @spec SPEC-HTML-101
test("malformed Astro wrappers produce located diagnostics", () => {
  const missingContext = diagnoseDocument(
    document("<template flowview>text</template>", "/tmp/Page.astro", "astro"),
    vscode,
  );
  assert.equal(missingContext[0]?.code, "FVASTRO");
  assert.equal(missingContext[0]?.range.start.line, 0);

  const missingClose = diagnoseDocument(
    document(
      "<template flowview context={context}>text",
      "/tmp/Page.astro",
      "astro",
    ),
    vscode,
  );
  assert.equal(missingClose[0]?.code, "FVASTRO");
  assert.ok(missingClose[0]?.message.includes("missing </template>"));
});

// @spec SPEC-HTML-103
test("Events diagnostics come from the Astro Events compiler", () => {
  const source = `---\nconst context = {};\n---\n<template flowview context={context} is:raw><button (click)="missing()">Save</button></template>`;
  const diagnostics = diagnoseDocument(
    document(source, "/tmp/Page.astro", "astro"),
    vscode,
  );
  assert.ok(
    diagnostics.some(
      (item) =>
        item.source === "FlowView Events" &&
        item.severity === vscode.DiagnosticSeverity.Error,
    ),
  );
});

// @spec SPEC-HTML-103
test("FlowView diagnostics follow the Events transform and map back to original Astro", () => {
  const source = `---\n---\n<button (click)="save()">Save</button>\n<template flowview context={context} is:raw>{{ }}</template>\n<script data-flowview>function save() {}</script>`;
  const diagnostics = diagnoseDocument(
    document(source, "/tmp/Page.astro", "astro"),
    vscode,
  );
  const error = diagnostics.find((item) => item.code === "FV0005");
  assert.ok(error);
  assert.equal(error.range.start.line, 3);
  const originalLine = source.split("\n")[error.range.start.line];
  assert.equal(
    originalLine.slice(error.range.start.character, error.range.end.character),
    "{{ ",
  );
});
