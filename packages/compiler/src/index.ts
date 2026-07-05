import { createRequire } from "node:module";

export interface FlowviewCompilerOptions {
  filename?: string;
  runtimeImport?: string;
}

export interface FlowviewCompilerDiagnostic {
  message: string;
  severity: "error" | "warning";
  code?: string | null;
  filename: string;
  line: number;
  column: number;
  start: number;
  end: number;
}

export interface FlowviewCompilerResult {
  code: string;
  warnings: FlowviewCompilerDiagnostic[];
}

export class FlowviewCompilerError extends Error {
  readonly diagnostics: FlowviewCompilerDiagnostic[];

  constructor(message: string, diagnostics: FlowviewCompilerDiagnostic[] = []) {
    super(message);
    this.name = "FlowviewCompilerError";
    this.diagnostics = diagnostics;
  }
}

type WasmCompileResult =
  | {
      status: "ok";
      code: string;
      warnings: FlowviewCompilerDiagnostic[];
    }
  | {
      status: "err";
      diagnostics: FlowviewCompilerDiagnostic[];
    };

const require = createRequire(import.meta.url);
const wasm = require("../pkg/flowview_wasm.js") as {
  compile(source: string, options: Record<string, unknown>): WasmCompileResult;
};

export function compileFlowview(
  source: string,
  options: FlowviewCompilerOptions = {},
): FlowviewCompilerResult {
  const result = wasm.compile(source, {
    filename: options.filename,
    runtimeImport: options.runtimeImport,
  });

  if (result.status === "ok") {
    return {
      code: result.code,
      warnings: result.warnings,
    };
  }

  throw new FlowviewCompilerError(
    result.diagnostics[0]?.message ?? "flowview compilation failed",
    result.diagnostics,
  );
}
