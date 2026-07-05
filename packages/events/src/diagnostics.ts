export interface FlowmarkDomLocation {
  line: number;
  column: number;
}

export interface FlowmarkDomDiagnostic {
  message: string;
  severity: "error" | "warning";
  filename: string;
  line: number;
  column: number;
}

export class FlowmarkDomError extends Error {
  readonly diagnostics: FlowmarkDomDiagnostic[];

  constructor(message: string, diagnostics: FlowmarkDomDiagnostic[] = []) {
    super(message);
    this.name = "FlowmarkDomError";
    this.diagnostics = diagnostics;
  }
}

export function locate(source: string, offset: number): FlowmarkDomLocation {
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
