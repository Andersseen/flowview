import { locate, type FlowmarkDomDiagnostic } from "./diagnostics.js";

export interface EventBinding {
  eventName: string;
  expression: string;
  start: number;
  end: number;
  attributeStart: number;
  attributeEnd: number;
}

export interface HandlerCall {
  name: string;
  args: HandlerArgument[];
}

export type HandlerArgument =
  | { type: "literal"; value: unknown }
  | { type: "event" }
  | { type: "element" };

export interface FrontmatterFunction {
  name: string;
  parameters: string[];
  source: string;
  body: string;
  offset: number;
}

export interface ParsedFrontmatter {
  functions: FrontmatterFunction[];
}

const EVENT_NAME_RE = /^[\w-]+$/;
const EVENT_ATTR_RE = /\s\(([\w-]+)\)\s*=\s*(["'])(.*?)\2/g;
const FUNCTION_DECL_RE = /function\s+([a-zA-Z_$][\w$]*)/g;
const IDENTIFIER_RE = /[a-zA-Z_$][\w$]*/g;

const KNOWN_GLOBALS = new Set([
  "console",
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "fetch",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "JSON",
  "Math",
  "Date",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Promise",
  "Error",
  "Event",
  "HTMLElement",
  "Element",
  "Node",
  "Text",
  "Comment",
  "Document",
  "DocumentFragment",
  "localStorage",
  "sessionStorage",
  "undefined",
]);

export function findEventBindings(html: string): EventBinding[] {
  const bindings: EventBinding[] = [];
  EVENT_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = EVENT_ATTR_RE.exec(html)) !== null) {
    const eventName = match[1]!;
    const quote = match[2]!;
    const expression = match[3]!;
    const attributeStart = match.index;
    const attributeEnd = match.index + match[0].length;

    if (!EVENT_NAME_RE.test(eventName)) {
      continue;
    }

    bindings.push({
      eventName,
      expression,
      start: match.index + match[0].indexOf("("),
      end: attributeEnd,
      attributeStart,
      attributeEnd,
    });
  }

  return bindings;
}

export function parseHandlerExpression(expression: string): HandlerCall {
  const source = expression.trim();
  const { name, argsSource, argsStart } = parseCallShape(source);
  const args = argsSource === "" ? [] : parseArgumentList(argsSource, argsStart);

  return { name, args };
}

function parseCallShape(source: string): {
  name: string;
  argsSource: string;
  argsStart: number;
} {
  let index = 0;

  index = skipWhitespace(source, index);
  const nameStart = index;
  if (!isIdentifierStart(source[index])) {
    throw new Error(
      `FlowMark event handler must be a function call, got "${source}".`,
    );
  }
  index = readIdentifier(source, index);
  const name = source.slice(nameStart, index);
  index = skipWhitespace(source, index);

  if (source[index] !== "(") {
    throw new Error(
      `FlowMark event handler "${name}" must be called with parentheses.`,
    );
  }
  index += 1;
  const argsStart = index;
  let parenDepth = 1;
  while (index < source.length && parenDepth > 0) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(source, index, char);
    } else if (char === "(" || char === "[" || char === "{") {
      parenDepth += 1;
      index += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      parenDepth -= 1;
      if (parenDepth === 0) break;
      index += 1;
    } else {
      index += 1;
    }
  }

  if (parenDepth !== 0) {
    throw new Error(
      `FlowMark event handler "${name}" has unbalanced parentheses.`,
    );
  }

  const argsSource = source.slice(argsStart, index);
  return { name, argsSource, argsStart };
}

function parseArgumentList(
  argsSource: string,
  globalOffset: number,
): HandlerArgument[] {
  const args: HandlerArgument[] = [];
  let index = 0;

  while (index < argsSource.length) {
    index = skipWhitespace(argsSource, index);
    if (index >= argsSource.length) break;

    const arg = parseArgument(argsSource, index, globalOffset + index);
    args.push(arg);
    index = argEnd(argsSource, index);

    index = skipWhitespace(argsSource, index);
    if (argsSource[index] === ",") {
      index += 1;
    } else if (index < argsSource.length) {
      throw new Error(
        `FlowMark event handler arguments must be separated by commas, got "${argsSource.slice(index)}".`,
      );
    }
  }

  return args;
}

function parseArgument(
  source: string,
  start: number,
  offset: number,
): HandlerArgument {
  const char = source[start];

  if (char === '"' || char === "'") {
    const { value, end } = readStringLiteral(source, start, char);
    return { type: "literal", value };
  }

  if (char === "`") {
    throw new Error(
      `FlowMark event handler argument template literals are not supported at ${offset}.`,
    );
  }

  if (char === "[" || char === "{" || char === "(") {
    throw new Error(
      `FlowMark event handler argument must be a simple literal or $event/$el at ${offset}.`,
    );
  }

  if (isDigit(char) || (char === "-" && isDigit(source[start + 1]))) {
    const { value, end } = readNumberLiteral(source, start);
    return { type: "literal", value };
  }

  if (isIdentifierStart(char)) {
    const { identifier, end } = readIdentifierWithEnd(source, start);
    if (identifier === "true") return { type: "literal", value: true };
    if (identifier === "false") return { type: "literal", value: false };
    if (identifier === "null") return { type: "literal", value: null };
    if (identifier === "$event") return { type: "event" };
    if (identifier === "$el") return { type: "element" };
    throw new Error(
      `FlowMark event handler argument "${identifier}" is not supported at ${offset}.`,
    );
  }

  throw new Error(
    `FlowMark event handler argument is invalid at ${offset}: "${source[start]}".`,
  );
}

function argEnd(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(source, index, char);
    } else if (char === "," || char === ")" || char === "]" || char === "}") {
      break;
    } else {
      index += 1;
    }
  }
  return index;
}

export function extractFrontmatterFunctions(
  frontmatter: string,
): ParsedFrontmatter {
  const functions: FrontmatterFunction[] = [];
  FUNCTION_DECL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FUNCTION_DECL_RE.exec(frontmatter)) !== null) {
    const name = match[1]!;
    const start = match.index;
    let index = match.index + match[0].length;

    const { parameters, end: paramsEnd } = parseParameterList(frontmatter, index);
    index = paramsEnd;
    index = skipWhitespace(frontmatter, index);

    if (frontmatter[index] !== "{") {
      continue;
    }

    const bodyStart = index;
    const bodyEnd = findMatchingBrace(frontmatter, bodyStart);
    if (bodyEnd === -1) {
      continue;
    }

    const source = frontmatter.slice(start, bodyEnd + 1);
    const body = frontmatter.slice(bodyStart + 1, bodyEnd);

    functions.push({
      name,
      parameters,
      source,
      body,
      offset: start,
    });
  }

  return { functions };
}

function parseParameterList(
  source: string,
  start: number,
): { parameters: string[]; end: number } {
  const parameters: string[] = [];
  let index = skipWhitespace(source, start);

  if (source[index] !== "(") {
    return { parameters, end: start };
  }
  index += 1;

  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (source[index] === ")") {
      index += 1;
      break;
    }

    if (source[index] === "{" || source[index] === "[") {
      throw new Error(
        `FlowMark event handler destructured parameters are not supported.`,
      );
    }

    if (!isIdentifierStart(source[index])) {
      throw new Error(
        `FlowMark event handler parameter list is invalid at ${index}.`,
      );
    }

    const { identifier, end } = readIdentifierWithEnd(source, index);
    parameters.push(identifier);
    index = end;
    index = skipWhitespace(source, index);

    if (source[index] === ":") {
      index += 1;
      index = skipType(source, index);
    } else if (source[index] === "=") {
      index += 1;
      index = skipExpression(source, index);
    }

    index = skipWhitespace(source, index);
    if (source[index] === ",") {
      index += 1;
    } else if (source[index] !== ")") {
      throw new Error(
        `FlowMark event handler parameter list is invalid at ${index}.`,
      );
    }
  }

  return { parameters, end: index };
}

function skipType(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(source, index, char);
    } else if (char === "," || char === ")" || char === "=") {
      break;
    } else {
      index += 1;
    }
  }
  return index;
}

function skipExpression(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(source, index, char);
    } else if (char === "," || char === ")") {
      break;
    } else {
      index += 1;
    }
  }
  return index;
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 1;
  let index = openIndex + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(source, index, char);
    } else if (char === "{") {
      depth += 1;
      index += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
      index += 1;
    } else {
      index += 1;
    }
  }
  return -1;
}

export function analyzeCaptures(func: FrontmatterFunction): string[] {
  const locals = new Set(func.parameters);
  const localDeclarations = findLocalDeclarations(func.body);
  localDeclarations.forEach((name) => locals.add(name));

  const captures = new Set<string>();
  const tokens = tokenizeIdentifiers(func.body);

  for (const { name, index, isPropertyAccess, isDeclaration } of tokens) {
    if (locals.has(name)) continue;
    if (KNOWN_GLOBALS.has(name)) continue;
    if (isPropertyAccess) continue;
    if (isDeclaration) continue;

    captures.add(name);
  }

  return Array.from(captures);
}

interface IdentifierToken {
  name: string;
  index: number;
  isPropertyAccess: boolean;
  isDeclaration: boolean;
}

function tokenizeIdentifiers(source: string): IdentifierToken[] {
  const tokens: IdentifierToken[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (index >= source.length) break;

    const char = source[index];

    if (char === "/" && source[index + 1] === "/") {
      index = skipLineComment(source, index);
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      index = skipBlockComment(source, index);
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      index = skipString(source, index, char);
      continue;
    }

    if (isDigit(char)) {
      index = skipNumber(source, index);
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index = readIdentifier(source, index);
      const name = source.slice(start, index);
      const isPropertyAccess = isDotBefore(source, start);
      const isDeclaration = isDeclarationContext(source, start);
      tokens.push({ name, index: start, isPropertyAccess, isDeclaration });
      continue;
    }

    index += 1;
  }

  return tokens;
}

function skipLineComment(source: string, start: number): number {
  const end = source.indexOf("\n", start);
  return end === -1 ? source.length : end + 1;
}

function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

function skipNumber(source: string, start: number): number {
  let index = start;
  if (source[index] === "-") index += 1;
  while (index < source.length && isDigit(source[index])) index += 1;
  if (source[index] === ".") {
    index += 1;
    while (index < source.length && isDigit(source[index])) index += 1;
  }
  return index;
}

function isDotBefore(source: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) {
    cursor -= 1;
  }
  return source[cursor] === ".";
}

function isDeclarationContext(source: string, index: number): boolean {
  const before = source.slice(0, index).trimEnd();
  if (/\b(const|let|var|function)\s*$/.test(before)) return true;
  // Object property shorthand keys are not declarations in this context.
  return false;
}

function findLocalDeclarations(body: string): string[] {
  const names: string[] = [];
  let index = 0;

  while (index < body.length) {
    index = skipWhitespace(body, index);
    if (index >= body.length) break;

    const char = body[index];

    if (char === "/" && body[index + 1] === "/") {
      index = skipLineComment(body, index);
      continue;
    }

    if (char === "/" && body[index + 1] === "*") {
      index = skipBlockComment(body, index);
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      index = skipString(body, index, char);
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index = readIdentifier(body, index);
      const name = body.slice(start, index);

      if (name === "const" || name === "let" || name === "var") {
        index = skipWhitespace(body, index);
        while (index < body.length) {
          index = skipWhitespace(body, index);
          if (!isIdentifierStart(body[index])) break;
          const declStart = index;
          index = readIdentifier(body, index);
          const declName = body.slice(declStart, index);
          names.push(declName);

          index = skipWhitespace(body, index);
          if (body[index] === ":") {
            index += 1;
            index = skipType(body, index);
          } else if (body[index] === "=") {
            index += 1;
            index = skipExpression(body, index);
          }

          index = skipWhitespace(body, index);
          if (body[index] === ",") {
            index += 1;
          } else {
            break;
          }
        }
        continue;
      }

      if (name === "function") {
        index = skipWhitespace(body, index);
        if (isIdentifierStart(body[index])) {
          const declStart = index;
          index = readIdentifier(body, index);
          names.push(body.slice(declStart, index));
        }
      }

      continue;
    }

    index += 1;
  }

  return names;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return index;
}

function skipString(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
    } else if (char === quote) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return index;
}

function readStringLiteral(
  source: string,
  start: number,
  quote: string,
): { value: string; end: number } {
  let index = start + 1;
  let value = "";
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      const escaped = source[index + 1];
      switch (escaped) {
        case '"':
          value += '"';
          break;
        case "'":
          value += "'";
          break;
        case "\\":
          value += "\\";
          break;
        case "n":
          value += "\n";
          break;
        case "t":
          value += "\t";
          break;
        case "r":
          value += "\r";
          break;
        default:
          value += escaped ?? char;
      }
      index += 2;
    } else if (char === quote) {
      index += 1;
      break;
    } else {
      value += char;
      index += 1;
    }
  }
  return { value, end: index };
}

function readNumberLiteral(
  source: string,
  start: number,
): { value: number; end: number } {
  let index = start;
  if (source[index] === "-") index += 1;
  while (index < source.length && isDigit(source[index])) {
    index += 1;
  }
  if (source[index] === ".") {
    index += 1;
    while (index < source.length && isDigit(source[index])) {
      index += 1;
    }
  }
  const value = Number(source.slice(start, index));
  return { value, end: index };
}

function readIdentifier(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length && isIdentifierPart(source[index])) {
    index += 1;
  }
  return index;
}

function readIdentifierWithEnd(
  source: string,
  start: number,
): { identifier: string; end: number } {
  const end = readIdentifier(source, start);
  return { identifier: source.slice(start, end), end };
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[a-zA-Z_$]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[a-zA-Z0-9_$]/.test(char);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && /[0-9]/.test(char);
}
