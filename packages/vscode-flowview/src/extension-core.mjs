import { diagnoseDocument } from "./diagnostics.mjs";

export { diagnoseDocument };

const DEBOUNCE_MS = 120;

export function activateWithApi(context, vscode) {
  const diagnostics = vscode.languages.createDiagnosticCollection("flowview");
  const timers = new Map();
  context.subscriptions.push(diagnostics, {
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  });

  const publish = (document) => {
    if (!isRelevant(document)) {
      diagnostics.delete(document.uri);
      return;
    }
    const key = document.uri.toString();
    const previous = timers.get(key);
    if (previous) clearTimeout(previous);
    timers.delete(key);
    try {
      diagnostics.set(document.uri, diagnoseDocument(document, vscode));
    } catch {
      diagnostics.delete(document.uri);
    }
  };

  const schedule = (document) => {
    if (!isRelevant(document)) {
      diagnostics.delete(document.uri);
      return;
    }
    const key = document.uri.toString();
    const previous = timers.get(key);
    if (previous) clearTimeout(previous);
    const version = document.version;
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        if (document.isClosed || document.version !== version) return;
        publish(document);
      }, DEBOUNCE_MS),
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(publish),
    vscode.workspace.onDidSaveTextDocument(publish),
    vscode.workspace.onDidChangeTextDocument((event) =>
      schedule(event.document),
    ),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
      diagnostics.delete(document.uri);
    }),
  );
  for (const document of vscode.workspace.textDocuments) publish(document);
}

function isRelevant(document) {
  return (
    document.languageId === "flowview" ||
    document.languageId === "astro" ||
    document.uri.fsPath.endsWith(".flow") ||
    document.uri.fsPath.endsWith(".astro")
  );
}
