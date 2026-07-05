export interface FlowviewDomLocation {
  line: number;
  column: number;
}

export interface FlowviewDomDiagnostic {
  message: string;
  severity: "error" | "warning";
  filename: string;
  line: number;
  column: number;
}

export class FlowviewDomError extends Error {
  readonly diagnostics: FlowviewDomDiagnostic[];

  constructor(message: string, diagnostics: FlowviewDomDiagnostic[] = []) {
    super(message);
    this.name = "FlowviewDomError";
    this.diagnostics = diagnostics;
  }
}

export function locate(source: string, offset: number): FlowviewDomLocation {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
