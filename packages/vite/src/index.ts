import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export interface FlowmarkViteOptions {
  runtimeImport?: string;
  /** Optional path to a custom `flowmark` CLI binary. */
  compilerPath?: string;
}

export interface FlowmarkCompileRequest {
  filename: string;
  lineOffset?: number;
  runtimeImport: string;
  compilerPath?: string;
}

export interface FlowmarkDiagnostic {
  message: string;
  severity: "error" | "warning";
  code?: string | null;
  filename: string;
  line: number;
  column: number;
  start: number;
  end: number;
}

export class FlowmarkCompileError extends Error {
  readonly diagnostics: FlowmarkDiagnostic[];

  constructor(message: string, diagnostics: FlowmarkDiagnostic[] = []) {
    super(message);
    this.name = "FlowmarkCompileError";
    this.diagnostics = diagnostics;
  }
}

interface FlowmarkCompileResult {
  code: string;
  warnings: FlowmarkDiagnostic[];
}

const compileCache = new Map<string, Promise<FlowmarkCompileResult>>();

export default function flowmark(options: FlowmarkViteOptions = {}): Plugin {
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
        const { code: compiled, warnings } = await compileFlowmark(code, {
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
          error instanceof FlowmarkCompileError &&
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

export function compileFlowmark(
  source: string,
  request: FlowmarkCompileRequest,
): Promise<FlowmarkCompileResult> {
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
  request: Required<Pick<FlowmarkCompileRequest, "compilerPath">> &
    FlowmarkCompileRequest,
): Promise<FlowmarkCompileResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      request.compilerPath,
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
          new FlowmarkCompileError(
            `Flowmark compiler was not found at "${request.compilerPath}". ` +
              "Install the Flowmark CLI, run `cargo build --workspace` in the monorepo, " +
              "or provide compilerPath explicitly.",
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      if (exitCode === 0) {
        const warnings = parseDiagnostics(stderr);
        resolve({ code: stdout, warnings });
        return;
      }

      const diagnostics = parseDiagnostics(stderr);
      reject(
        new FlowmarkCompileError(
          diagnostics.length > 0
            ? formatDiagnostic(diagnostics[0]!)
            : `Failed to compile Flowmark template ${request.filename}\n${stderr}`,
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

function parseDiagnostics(stderr: string): FlowmarkDiagnostic[] {
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
      diagnostics?: FlowmarkDiagnostic[];
    };
    return parsed.diagnostics ?? [];
  } catch {
    return [];
  }
}

function formatDiagnostic(diagnostic: FlowmarkDiagnostic): string {
  const code = diagnostic.code ? ` [${diagnostic.code}]` : "";
  return `${diagnostic.message}${code}`;
}

function formatDiagnosticWithLocation(
  diagnostic: FlowmarkDiagnostic,
  filename: string,
): string {
  const code = diagnostic.code ? ` [${diagnostic.code}]` : "";
  return `${filename}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}${code}`;
}

/** Resolve the compiler automatically for normal usage and monorepo development. */
export function resolveCompilerPath(compilerPath?: string): string {
  if (compilerPath) return compilerPath;
  if (process.env.FLOWMARK_COMPILER_PATH) {
    return process.env.FLOWMARK_COMPILER_PATH;
  }

  const executable = process.platform === "win32" ? "flowmark.exe" : "flowmark";
  const workspaceCandidates = [
    fileURLToPath(
      new URL(`../../../target/debug/${executable}`, import.meta.url),
    ),
    fileURLToPath(
      new URL(`../../../target/release/${executable}`, import.meta.url),
    ),
  ];

  return (
    workspaceCandidates.find((candidate) => existsSync(candidate)) ?? executable
  );
}

function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}

/** Exported for integrations that need to clear cached compilations. */
export function clearCompileCache(): void {
  compileCache.clear();
}
