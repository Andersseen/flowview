import {
  locate,
  FlowmarkDomError,
  type FlowmarkDomDiagnostic,
} from "./diagnostics.js";
import {
  analyzeAllCaptures,
  extractFrontmatterFunctions,
  findEventBindings,
  findUnsupportedHandlerNames,
  parseHandlerExpression,
  type EventBinding,
  type FrontmatterFunction,
  type HandlerArgument,
} from "./parser.js";

export interface CompileEventsRequest {
  filename: string;
  frontmatter: string;
  template: string;
  runtimeImport?: string;
}

export interface CompileEventsResult {
  html: string;
  clientModule: string;
  diagnostics: FlowmarkDomDiagnostic[];
}

const DEFAULT_RUNTIME_IMPORT = "@flowmark/dom/runtime";

export function compileEvents(
  request: CompileEventsRequest,
): CompileEventsResult {
  const runtimeImport = request.runtimeImport ?? DEFAULT_RUNTIME_IMPORT;
  const diagnostics: FlowmarkDomDiagnostic[] = [];

  const bindings = findEventBindings(request.template);
  if (bindings.length === 0) {
    return {
      html: request.template,
      clientModule: "",
      diagnostics,
    };
  }

  const frontmatter = extractFrontmatterFunctions(request.frontmatter);
  const functionsByName = new Map<string, FrontmatterFunction>();
  for (const func of frontmatter.functions) {
    if (functionsByName.has(func.name)) {
      diagnostics.push({
        message: `Flowmark event handler "${func.name}" is declared more than once in frontmatter.`,
        severity: "error",
        filename: request.filename,
        ...locate(request.frontmatter, func.offset),
      });
    }
    functionsByName.set(func.name, func);
  }

  const handlers = new Map<string, FrontmatterFunction>();
  const processedBindings: ProcessedBinding[] = [];
  const unsupportedHandlers = new Set(findUnsupportedHandlerNames(request.frontmatter));

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

    const func = functionsByName.get(call.name);
    if (func === undefined) {
      const isUnsupported = unsupportedHandlers.has(call.name);
      const message = isUnsupported
        ? `Flowmark event handler "${call.name}" must be declared as a function (\`function ${call.name}(...) { ... }\`). Arrow functions and function expressions are not supported yet.`
        : `Flowmark event handler "${call.name}" was used in the template but was not found in frontmatter.`;
      diagnostics.push({
        message,
        severity: "error",
        filename: request.filename,
        ...locate(request.template, binding.start),
      });
      continue;
    }

    if (call.name !== func.name) {
      // Defensive; should not happen.
      continue;
    }

    handlers.set(func.name, func);

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

    processedBindings.push({
      binding,
      handlerName: call.name,
      args: call.args,
    });
  }

  const captureMap = analyzeAllCaptures(
    request.frontmatter,
    Array.from(handlers.values()),
  );
  for (const func of handlers.values()) {
    const captures = captureMap.get(func.name) ?? [];
    if (captures.length > 0) {
      diagnostics.push({
        message: `Flowmark cannot move "${func.name}" to the client because it captures ${captures.map((name: string) => `"${name}"`).join(", ")}.`,
        severity: "error",
        filename: request.filename,
        ...locate(request.frontmatter, func.offset),
      });
    }
  }

  if (diagnostics.some((d) => d.severity === "error")) {
    throw new FlowmarkDomError(
      `Flowmark Events compilation failed for ${request.filename}`,
      diagnostics,
    );
  }

  const html = generateHtml(request.template, processedBindings);
  const clientModule = generateClientModule(
    Array.from(handlers.values()),
    runtimeImport,
  );

  return { html, clientModule, diagnostics };
}

interface ProcessedBinding {
  binding: EventBinding;
  handlerName: string;
  args: HandlerArgument[];
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

function generateHtml(template: string, bindings: ProcessedBinding[]): string {
  const sorted = [...bindings].sort(
    (a, b) => b.binding.start - a.binding.start,
  );
  let html = template;

  for (const { binding, handlerName, args } of sorted) {
    const dataEventName = `data-flow-on-${binding.eventName}`;
    const serializedArgs = serializeArguments(args);
    const argsAttribute =
      serializedArgs === undefined
        ? ""
        : ` data-flow-args=${escapeHtmlAttribute(JSON.stringify(serializedArgs))}`;
    const replacement = ` ${dataEventName}=${escapeHtmlAttribute(handlerName)}${argsAttribute}`;

    html =
      html.slice(0, binding.attributeStart) +
      replacement +
      html.slice(binding.attributeEnd);
  }

  return html;
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

function generateClientModule(
  functions: FrontmatterFunction[],
  runtimeImport: string,
): string {
  if (functions.length === 0) return "";

  const imports = `import { bindFlowEvents } from "${runtimeImport}";\n\n`;
  const handlerSources = functions
    .map((func) => generateClientFunction(func))
    .join("\n\n");
  const handlerNames = functions.map((func) => func.name).join(",\n  ");

  return `${imports}${handlerSources}\n\nbindFlowEvents({\n  ${handlerNames},\n});\n`;
}

function generateClientFunction(func: FrontmatterFunction): string {
  const params = func.parameters.join(", ");
  const asyncKeyword = func.isAsync ? "async " : "";
  return `${asyncKeyword}function ${func.name}(${params}) {${func.body}}`;
}

export { findEventBindings, extractFrontmatterFunctions };
export type { EventBinding, FrontmatterFunction, HandlerArgument };
