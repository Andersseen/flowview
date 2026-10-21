import { compileFlowview, FlowviewCompilerError } from "@flowview/compiler";
import {
  GREATEST_LOWER_BOUND,
  LEAST_UPPER_BOUND,
  originalPositionFor,
  TraceMap,
} from "@jridgewell/trace-mapping";
import { findEmbeddedTemplates } from "../../astro/src/embedded-regions.js";
import { analyzeAstroEvents } from "../../astro-events/src/index.js";
import { utf8ByteOffsetToCodeUnit } from "./offsets.mjs";

export function diagnoseDocument(document, vscode) {
  const source = document.getText();
  if (
    document.languageId === "flowview" ||
    document.uri.fsPath.endsWith(".flow")
  ) {
    return compileDiagnostics(source, document.uri.fsPath, document, vscode);
  }
  if (
    document.languageId !== "astro" &&
    !document.uri.fsPath.endsWith(".astro")
  )
    return [];

  const events = analyzeAstroEvents(source, document.uri.fsPath);
  const diagnostics = events.diagnostics.map((item) => {
    const start = new vscode.Position(
      Math.max(0, item.line - 1),
      Math.max(0, item.column - 1),
    );
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(start, start.translate(0, 1)),
      item.message,
      item.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error,
    );
    diagnostic.source = "FlowView Events";
    return diagnostic;
  });
  if (events.diagnostics.length > 0) return diagnostics;

  let originalRegions;
  try {
    originalRegions = findEmbeddedTemplates(source, document.uri.fsPath);
  } catch (error) {
    const diagnostic = wrapperDiagnostic(error, vscode);
    return diagnostic ? [diagnostic] : [];
  }
  let regions;
  try {
    regions = findEmbeddedTemplates(events.code, document.uri.fsPath);
  } catch (error) {
    const diagnostic = wrapperDiagnostic(error, vscode);
    return diagnostic ? [diagnostic] : [];
  }
  const map = events.map ? new TraceMap(events.map) : undefined;

  for (const [index, region] of regions.entries()) {
    const originalRegion = originalRegions[index];
    const local = compileDiagnostics(
      region.source,
      document.uri.fsPath,
      document,
      vscode,
    );
    for (const item of local) {
      const startOffset =
        region.bodyStart +
        utf8ByteOffsetToCodeUnit(region.source, item.byteStart);
      const endOffset =
        region.bodyStart +
        utf8ByteOffsetToCodeUnit(region.source, item.byteEnd);
      const unchangedRegion = originalRegion?.source === region.source;
      const start = unchangedRegion
        ? document.positionAt(
            originalRegion.bodyStart +
              utf8ByteOffsetToCodeUnit(originalRegion.source, item.byteStart),
          )
        : toEditorPosition(
            events.code,
            startOffset,
            map,
            document,
            vscode,
            GREATEST_LOWER_BOUND,
          );
      const end = unchangedRegion
        ? document.positionAt(
            originalRegion.bodyStart +
              utf8ByteOffsetToCodeUnit(originalRegion.source, item.byteEnd),
          )
        : toEditorPosition(
            events.code,
            endOffset,
            map,
            document,
            vscode,
            LEAST_UPPER_BOUND,
          );
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(start, end),
        item.message,
        item.severity,
      );
      diagnostic.code = item.code;
      diagnostic.source = item.source;
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

function toEditorPosition(source, offset, map, document, vscode, bias) {
  if (!map) return document.positionAt(offset);
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  const column = before.length - (before.lastIndexOf("\n") + 1);
  const original = originalPositionFor(map, { line, column, bias });
  if (original.line === null || original.column === null)
    return document.positionAt(offset);
  return new vscode.Position(original.line - 1, original.column);
}

function compileDiagnostics(source, filename, document, vscode) {
  let compilerDiagnostics;
  try {
    compilerDiagnostics = compileFlowview(source, { filename }).warnings;
  } catch (error) {
    if (!(error instanceof FlowviewCompilerError)) return [];
    compilerDiagnostics = error.diagnostics;
  }
  return compilerDiagnostics.map((item) => {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(
        document.positionAt(utf8ByteOffsetToCodeUnit(source, item.start)),
        document.positionAt(utf8ByteOffsetToCodeUnit(source, item.end)),
      ),
      item.message,
      item.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error,
    );
    diagnostic.code = item.code ?? undefined;
    diagnostic.source = "FlowView";
    Object.assign(diagnostic, { byteStart: item.start, byteEnd: item.end });
    return diagnostic;
  });
}

function wrapperDiagnostic(error, vscode) {
  if (!(error instanceof Error) || !("loc" in error)) return undefined;
  const start = new vscode.Position(
    Math.max(0, error.loc.line - 1),
    Math.max(0, error.loc.column - 1),
  );
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(start, start.translate(0, 1)),
    error.message,
    vscode.DiagnosticSeverity.Error,
  );
  diagnostic.code = "FVASTRO";
  diagnostic.source = "FlowView";
  return diagnostic;
}
