const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "flowview-vsix-"));
  try {
    const flowPath = path.join(root, "page.flow");
    await fs.writeFile(flowPath, "é€漢🙂👩‍💻�\n<div>{{ }}</div>");
    const flowDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(flowPath));
    await vscode.window.showTextDocument(flowDocument);
    const flowDiagnostics = await waitFor(flowDocument.uri, (items) => items.some((item) => item.code === "FV0005"));
    const empty = flowDiagnostics.find((item) => item.code === "FV0005");
    assert.equal(empty.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(flowDocument.getText().split("\n")[1].slice(empty.range.start.character, empty.range.end.character), "{{ ");

    await vscode.workspace.applyEdit(replaceDocument(flowDocument, "<div>{{ context.title }}</div>"));
    await waitFor(flowDocument.uri, (items) => items.length === 0);
    await vscode.workspace.applyEdit(replaceDocument(flowDocument, "<div>{{ }}</div>"));
    await waitFor(flowDocument.uri, (items) => items.some((item) => item.code === "FV0005"));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await waitFor(flowDocument.uri, (items) => items.length === 0);

    const astroPath = path.join(root, "page.astro");
    const astroSource = `---\nconst context = {};\n---\n<template flowview context={context} is:raw>{{ }}</template>\n<template flowview={context} is:raw>@if () {x}</template>`;
    await fs.writeFile(astroPath, astroSource);
    let astroDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(astroPath));
    astroDocument = await vscode.languages.setTextDocumentLanguage(astroDocument, "astro");
    await vscode.window.showTextDocument(astroDocument);
    const astroDiagnostics = await waitFor(
      astroDocument.uri,
      (items) => items.some((item) => item.code === "FV0005") && items.some((item) => item.code === "FV0007"),
    );
    assert.ok(astroDiagnostics.find((item) => item.code === "FV0005").range.start.line < astroDiagnostics.find((item) => item.code === "FV0007").range.start.line);

    const eventsPath = path.join(root, "events.astro");
    await fs.writeFile(eventsPath, `---\n---\n<button (click)="save()">Save</button>\n<script data-flowview>function other() {}</script>`);
    let eventsDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(eventsPath));
    eventsDocument = await vscode.languages.setTextDocumentLanguage(eventsDocument, "astro");
    await vscode.window.showTextDocument(eventsDocument);
    const eventsDiagnostics = await waitFor(eventsDocument.uri, (items) => items.some((item) => item.source === "FlowView Events"));
    assert.ok(eventsDiagnostics.find((item) => item.source === "FlowView Events").message.includes("was used in the template but was not found"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

function replaceDocument(document, value) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), value);
  return edit;
}

async function waitFor(uri, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (predicate(diagnostics)) return diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Timed out waiting for FlowView diagnostics for ${uri.fsPath}`);
}
