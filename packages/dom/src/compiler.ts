import {
  locate,
  FlowmarkDomError,
  type FlowmarkDomDiagnostic,
} from "./diagnostics.js";
import {
  extractFunctionDeclarations,
  findEventBindings,
  findUnsupportedHandlerNames,
  parseHandlerExpression,
  type DeclaredFunction,
  type HandlerArgument,
} from "./parser.js";

const DEFAULT_RUNTIME_IMPORT = "@flowmark/dom/runtime";

export interface CompileScriptEventsRequest {
  filename: string;
  /** Scope id embedded in `data-flow-scope`; typically a hash of the file path. */
  scope: string;
  /** The post-frontmatter region of the `.astro` file (same slice legacy uses). */
  template: string;
  /** Offset of `scriptSource` within `template`, used to keep all diagnostics
   * in one coordinate space. */
  scriptOffset: number;
  /** Inner text content of the `<script data-flowmark>` block. */
  scriptSource: string;
  runtimeImport?: string;
}

export interface TemplateEdit {
  start: number;
  end: number;
  replacement: string;
}

export interface CompileScriptEventsResult {
  templateEdits: TemplateEdit[];
  scriptAppend: string;
  events: string[];
}

export function compileScriptEvents(
  request: CompileScriptEventsRequest,
): CompileScriptEventsResult {
  const runtimeImport = request.runtimeImport ?? DEFAULT_RUNTIME_IMPORT;
  const diagnostics: FlowmarkDomDiagnostic[] = [];

  const bindings = findEventBindings(request.template);
  const declaredByName = new Map<string, DeclaredFunction[]>();
  for (const func of extractFunctionDeclarations(request.scriptSource)) {
    const existing = declaredByName.get(func.name);
    if (existing) {
      existing.push(func);
    } else {
      declaredByName.set(func.name, [func]);
    }
  }

  for (const occurrences of declaredByName.values()) {
    for (const duplicate of occurrences.slice(1)) {
      diagnostics.push({
        message: `Flowmark event handler "${duplicate.name}" is declared more than once in the <script data-flowmark> block.`,
        severity: "error",
        filename: request.filename,
        ...locate(request.template, request.scriptOffset + duplicate.offset),
      });
    }
  }

  const unsupportedNames = new Set(
    findUnsupportedHandlerNames(request.scriptSource),
  );

  const templateEdits: TemplateEdit[] = [];
  const usedHandlerNames = new Set<string>();
  const usedEventNames = new Set<string>();

  for (const binding of bindings) {
    let call: ReturnType<typeof parseHandlerExpression>;
    try {
      call = parseHandlerExpression(binding.expression);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        message,
        severity: "error",
        filename: request.filename,
        ...locate(request.template, binding.start),
      });
      continue;
    }

    if (!declaredByName.has(call.name)) {
      const isUnsupported = unsupportedNames.has(call.name);
      const message = isUnsupported
        ? `Flowmark event handler "${call.name}" must be declared as a function (\`function ${call.name}(...) { ... }\`) inside the <script data-flowmark> block. Arrow functions and function expressions are not supported yet.`
        : `Flowmark event handler "${call.name}" was used in the template but was not found in the <script data-flowmark> block.`;
      diagnostics.push({
        message,
        severity: "error",
        filename: request.filename,
        ...locate(request.template, binding.start),
      });
      continue;
    }

    const argValidation = validateArguments(call.args);
    if (argValidation.error) {
      diagnostics.push({
        message: argValidation.error,
        severity: "error",
        filename: request.filename,
        ...locate(request.template, binding.start),
      });
      continue;
    }

    usedHandlerNames.add(call.name);
    usedEventNames.add(binding.eventName);

    const serializedArgs = serializeArguments(call.args);
    const argsAttribute =
      serializedArgs === undefined
        ? ""
        : ` data-flow-args=${escapeHtmlAttribute(JSON.stringify(serializedArgs))}`;
    const replacement =
      ` data-flow-on-${binding.eventName}=${escapeHtmlAttribute(call.name)}` +
      ` data-flow-scope=${escapeHtmlAttribute(request.scope)}${argsAttribute}`;

    templateEdits.push({
      start: binding.attributeStart,
      end: binding.attributeEnd,
      replacement,
    });
  }

  if (diagnostics.some((d) => d.severity === "error")) {
    throw new FlowmarkDomError(
      `Flowmark Events compilation failed for ${request.filename}`,
      diagnostics,
    );
  }

  const events = Array.from(usedEventNames).sort();
  const handlerNames = Array.from(usedHandlerNames).sort();
  const scriptAppend =
    handlerNames.length === 0
      ? ""
      : `\nimport { registerFlowHandlers } from "${runtimeImport}";\n` +
        `registerFlowHandlers(${JSON.stringify(request.scope)}, { ${handlerNames.join(", ")} }, ${JSON.stringify(events)});\n`;

  return { templateEdits, scriptAppend, events };
}

/** Applies `TemplateEdit`s to `template`, right-to-left so earlier offsets stay valid. */
export function applyTemplateEdits(
  template: string,
  edits: TemplateEdit[],
): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = template;
  for (const edit of sorted) {
    result =
      result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

function validateArguments(args: HandlerArgument[]): { error?: string } {
  for (const arg of args) {
    if (arg.type === "literal") {
      const value = arg.value;
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        value !== null
      ) {
        return { error: `Flowmark event argument cannot be serialized.` };
      }
    }
  }
  return {};
}

function serializeArguments(args: HandlerArgument[]): unknown[] | undefined {
  if (args.length === 0) return undefined;

  return args.map((arg) => {
    if (arg.type === "literal") return arg.value;
    if (arg.type === "event") return { __flow: "$event" };
    if (arg.type === "element") return { __flow: "$el" };
    return null;
  });
}

function escapeHtmlAttribute(value: string): string {
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `"${escaped}"`;
}

export { findEventBindings };
export type { HandlerArgument };
