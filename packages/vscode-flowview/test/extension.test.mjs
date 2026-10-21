import assert from "node:assert/strict";
import test from "node:test";
import { activateWithApi } from "../dist/extension-core.test.mjs";

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

function harness(documents = []) {
  const listeners = { open: [], save: [], change: [], close: [] };
  const collection = new Map();
  const diagnostics = {
    set: (uri, items) => collection.set(uri.toString(), items),
    delete: (uri) => collection.delete(uri.toString()),
    dispose() {},
  };
  const vscode = {
    Position,
    Range,
    Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    languages: { createDiagnosticCollection: () => diagnostics },
    workspace: {
      textDocuments: documents,
      onDidOpenTextDocument: (fn) => (
        listeners.open.push(fn),
        { dispose() {} }
      ),
      onDidSaveTextDocument: (fn) => (
        listeners.save.push(fn),
        { dispose() {} }
      ),
      onDidChangeTextDocument: (fn) => (
        listeners.change.push(fn),
        { dispose() {} }
      ),
      onDidCloseTextDocument: (fn) => (
        listeners.close.push(fn),
        { dispose() {} }
      ),
    },
  };
  const context = { subscriptions: [] };
  activateWithApi(context, vscode);
  return { collection, listeners, context };
}

function makeDocument(path, languageId, initialText) {
  let text = initialText;
  const document = {
    uri: { fsPath: path, toString: () => `file://${path}` },
    languageId,
    version: 1,
    isClosed: false,
    getText: () => text,
    setText: (next) => {
      text = next;
      document.version += 1;
    },
    positionAt(offset) {
      const before = text.slice(0, offset);
      const line = before.split("\n").length - 1;
      return new Position(line, before.length - (before.lastIndexOf("\n") + 1));
    },
  };
  return document;
}

// @spec SPEC-HTML-100
test("open, save, change, fix, stale edits, and close own the diagnostics collection", async () => {
  const document = makeDocument("/tmp/edit.flow", "flowview", "<p>{{ }}</p>");
  const { collection, listeners } = harness([document]);
  const key = document.uri.toString();
  assert.ok(collection.get(key)?.some((item) => item.code === "FV0005"));

  document.setText("<p>{{ context.title }}</p>");
  listeners.change[0]({ document });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(collection.get(key), []);

  document.setText("<p>{{ }}</p>");
  listeners.change[0]({ document });
  document.setText("<p>fixed</p>");
  listeners.change[0]({ document });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(collection.get(key), []);

  document.setText("<p>{{ }}</p>");
  listeners.save[0](document);
  assert.ok(collection.get(key)?.some((item) => item.code === "FV0005"));
  document.isClosed = true;
  listeners.close[0](document);
  assert.equal(collection.has(key), false);
});

// @spec SPEC-HTML-101
test("Astro diagnostics clear when a region is removed", () => {
  const document = makeDocument(
    "/tmp/edit.astro",
    "astro",
    "<template flowview context={x}>{{ }}</template>",
  );
  const { collection, listeners } = harness([document]);
  const key = document.uri.toString();
  assert.ok(collection.get(key)?.some((item) => item.code === "FV0005"));
  document.setText("<main>plain Astro</main>");
  listeners.change[0]({ document });
  return new Promise((resolve) => setTimeout(resolve, 150)).then(() => {
    assert.deepEqual(collection.get(key), []);
  });
});
