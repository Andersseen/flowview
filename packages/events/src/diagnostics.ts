export interface FlowviewEventsLocation {
  line: number;
  column: number;
}

export interface FlowviewEventsDiagnostic {
  message: string;
  severity: "error" | "warning";
  filename: string;
  line: number;
  column: number;
}

export class FlowviewEventsError extends Error {
  readonly diagnostics: FlowviewEventsDiagnostic[];

  constructor(message: string, diagnostics: FlowviewEventsDiagnostic[] = []) {
    super(message);
    this.name = "FlowviewEventsError";
    this.diagnostics = diagnostics;
  }
}

export function locate(source: string, offset: number): FlowviewEventsLocation {
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
