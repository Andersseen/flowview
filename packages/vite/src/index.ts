import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  compileFlowview as compileFlowviewWasm,
  FlowviewCompilerError,
  type FlowviewCompilerDiagnostic,
} from "@flowview/compiler";
import type { Plugin } from "vite";

export interface FlowviewViteOptions {
  runtimeImport?: string;
  /** Optional path to a custom `flowview` CLI binary. */
  compilerPath?: string;
}

export interface FlowviewCompileRequest {
  filename: string;
  lineOffset?: number;
  runtimeImport: string;
  compilerPath?: string;
}

export interface FlowviewDiagnostic {
  message: string;
  severity: "error" | "warning";
  code?: string | null;
  filename: string;
  line: number;
  column: number;
  start: number;
  end: number;
}

export class FlowviewCompileError extends Error {
  readonly diagnostics: FlowviewDiagnostic[];

  constructor(message: string, diagnostics: FlowviewDiagnostic[] = []) {
    super(message);
    this.name = "FlowviewCompileError";
    this.diagnostics = diagnostics;
  }
}

interface FlowviewCompileResult {
  code: string;
  warnings: FlowviewDiagnostic[];
}

const compileCache = new Map<string, Promise<FlowviewCompileResult>>();

export default function flowview(options: FlowviewViteOptions = {}): Plugin {
  const runtimeImport = options.runtimeImport ?? "@flowview/runtime";
  const compilerPath = resolveCompilerPath(options.compilerPath);

  return {
    name: "@flowview/vite",
    enforce: "pre",

    configResolved() {
      // Ensure configuration changes are reflected on the next build/dev session.
      compileCache.clear();
    },

    buildStart() {
      // Start each build with a fresh cache so stale compilations cannot leak
      // across rebuilds or config changes.
      compileCache.clear();
    },

    async transform(code, id) {
      const filename = stripQuery(id);
      if (!filename.endsWith(".flow")) return null;

      try {
        const { code: compiled, warnings } = await compileFlowview(code, {
          filename,
          runtimeImport,
          compilerPath,
        });

        for (const warning of warnings) {
          this.warn(formatDiagnosticWithLocation(warning, filename));
        }

        return {
          code: compiled,
          map: null,
        };
      } catch (error) {
        if (
          error instanceof FlowviewCompileError &&
          error.diagnostics.length > 0
        ) {
          const first = error.diagnostics[0]!;
          const message = error.diagnostics
            .map((diagnostic) => formatDiagnostic(diagnostic))
            .join("\n");
          this.error({
            message,
            id: filename,
            loc: {
              line: first.line,
              column: Math.max(0, first.column - 1),
            },
          });
        }
        throw error;
      }
    },

    handleHotUpdate({ file, server }) {
      if (file.endsWith(".flow")) {
        // Ensure Vite re-runs the transform for changed .flow files in dev.
        const moduleNode = server.moduleGraph.getModuleById(file);
        if (moduleNode) {
          server.moduleGraph.invalidateModule(moduleNode);
        }
      }
    },
  };
}

export function compileFlowview(
  source: string,
  request: FlowviewCompileRequest,
): Promise<FlowviewCompileResult> {
  const compilerPath = resolveCompilerPath(request.compilerPath);
  const normalizedRequest = { ...request, compilerPath };
  const cacheKey = createHash("sha256")
    .update(source)
    .update("\0")
    .update(JSON.stringify(normalizedRequest))
    .digest("hex");
  const cached = compileCache.get(cacheKey);
  if (cached) return cached;

  const compilation = runCompiler(source, normalizedRequest).catch((error) => {
    compileCache.delete(cacheKey);
    throw error;
  });
  compileCache.set(cacheKey, compilation);
  return compilation;
}

function runCompiler(
  source: string,
  request: FlowviewCompileRequest,
): Promise<FlowviewCompileResult> {
  const compilerPath = request.compilerPath;
  if (!compilerPath) {
    return runWasmCompiler(source, request);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      compilerPath,
      [
        "compile",
        "-",
        "--runtime",
        request.runtimeImport,
        "--display-name",
        request.filename,
        "--line-offset",
        String(request.lineOffset ?? 0),
        "--diagnostic-format",
        "json",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (error.code === "ENOENT") {
        reject(
          new FlowviewCompileError(
            `flowview compiler was not found at "${request.compilerPath}". ` +
              "Install the flowview CLI, run `cargo build --workspace` in the monorepo, " +
              "or provide compilerPath explicitly.",
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (exitCode === 0) {
        const warnings = parseDiagnostics(stderr);
        resolve({ code: stdout, warnings });
        return;
      }

      const diagnostics = parseDiagnostics(stderr);
      reject(
        new FlowviewCompileError(
          diagnostics.length > 0
            ? formatDiagnostic(diagnostics[0]!)
            : `Failed to compile flowview template ${request.filename}\n${stderr}`,
          diagnostics,
        ),
      );
    });

    child.stdin.on("error", () => {
      // The close/error handler reports the useful compiler failure.
    });
    child.stdin.end(source);
  });
}

function runWasmCompiler(
  source: string,
  request: FlowviewCompileRequest,
): Promise<FlowviewCompileResult> {
  return Promise.resolve().then(() => {
    try {
      const result = compileFlowviewWasm(source, {
        filename: request.filename,
        runtimeImport: request.runtimeImport,
      });
      return {
        code: result.code,
        warnings: applyLineOffset(result.warnings, request.lineOffset),
      };
    } catch (error) {
      if (error instanceof FlowviewCompilerError) {
        throw new FlowviewCompileError(
          error.message,
          applyLineOffset(error.diagnostics, request.lineOffset),
        );
      }
      throw error;
    }
  });
}

function parseDiagnostics(stderr: string): FlowviewDiagnostic[] {
  const lines = stderr.trim().split("\n");
  let line: string | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim().startsWith("{")) {
      line = lines[index];
      break;
    }
  }
  if (!line) return [];

  try {
    const parsed = JSON.parse(line) as {
      diagnostics?: FlowviewDiagnostic[];
    };
    return parsed.diagnostics ?? [];
  } catch {
    return [];
  }
}

function formatDiagnostic(diagnostic: FlowviewDiagnostic): string {
  const code = diagnostic.code ? ` [${diagnostic.code}]` : "";
  return `${diagnostic.message}${code}`;
}

function formatDiagnosticWithLocation(
  diagnostic: FlowviewDiagnostic,
  filename: string,
): string {
  const code = diagnostic.code ? ` [${diagnostic.code}]` : "";
  return `${filename}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}${code}`;
}

/** Resolve the compiler automatically for normal usage and monorepo development. */
export function resolveCompilerPath(compilerPath?: string): string {
  if (compilerPath) return compilerPath;
  if (process.env.FLOWVIEW_COMPILER_PATH) {
    return process.env.FLOWVIEW_COMPILER_PATH;
  }

  const executable = process.platform === "win32" ? "flowview.exe" : "flowview";
  const workspaceCandidates = [
    fileURLToPath(
      new URL(`../../../target/debug/${executable}`, import.meta.url),
    ),
    fileURLToPath(
      new URL(`../../../target/release/${executable}`, import.meta.url),
    ),
  ];

  return workspaceCandidates.find((candidate) => existsSync(candidate)) ?? "";
}

function applyLineOffset(
  diagnostics: readonly FlowviewCompilerDiagnostic[],
  lineOffset = 0,
): FlowviewDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    line: diagnostic.line + lineOffset,
  }));
}

function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}

/** Exported for integrations that need to clear cached compilations. */
export function clearCompileCache(): void {
  compileCache.clear();
}
