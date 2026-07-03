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
const FUNCTION_DECL_RE = /function\s+([a-zA-Z_$][\w$]*)/g;
const IDENTIFIER_RE = /[a-zA-Z_$][\w$]*/g;

const RESERVED_WORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

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
  let index = 0;

  while (index < html.length) {
    if (html.slice(index, index + 4) === "<!--") {
      index = skipHtmlComment(html, index);
      continue;
    }

    if (isRawTextTagStart(html, index, "script")) {
      index = skipRawTextElement(html, index, "script");
      continue;
    }

    if (isRawTextTagStart(html, index, "style")) {
      index = skipRawTextElement(html, index, "style");
      continue;
    }

    if (html[index] === "<") {
      const result = parseTagForEvents(html, index);
      bindings.push(...result.bindings);
      index = result.end;
      continue;
    }

    index += 1;
  }

  return bindings;
}

function skipHtmlComment(html: string, start: number): number {
  const end = html.indexOf("-->", start + 4);
  return end === -1 ? html.length : end + 3;
}

function isRawTextTagStart(
  html: string,
  start: number,
  tagName: string,
): boolean {
  const open = `<${tagName}`;
  const slice = html.slice(start, start + open.length).toLowerCase();
  if (slice !== open) return false;
  const next = html[start + open.length];
  return next === undefined || /[\s>]/.test(next);
}

function skipRawTextElement(html: string, start: number, tagName: string): number {
  const tagOpenEnd = html.indexOf(">", start + tagName.length + 1);
  if (tagOpenEnd === -1) return html.length;

  const close = `</${tagName}>`;
  const closeIndex = html.toLowerCase().indexOf(close, tagOpenEnd + 1);
  return closeIndex === -1 ? html.length : closeIndex + close.length;
}

interface TagParseResult {
  bindings: EventBinding[];
  end: number;
}

function parseTagForEvents(html: string, start: number): TagParseResult {
  const tagEnd = findTagEnd(html, start);
  if (tagEnd === -1) {
    return { bindings: [], end: html.length };
  }

  const content = html.slice(start + 1, tagEnd);
  const bindings: EventBinding[] = [];
  let index = 0;

  // Skip tag name.
  while (index < content.length && !/[\s>]/.test(content[index]!)) {
    index += 1;
  }

  while (index < content.length) {
    index = skipWhitespaceInString(content, index);
    if (index >= content.length) break;

    const char = content[index];
    if (char === "/" || char === ">") break;

    const attrStartInContent = index;
    const nameStart = index;
    while (
      index < content.length &&
      !/[\s=/>]/.test(content[index]!)
    ) {
      index += 1;
    }
    const name = content.slice(nameStart, index);
    const attrStartOffset = start + 1 + attrStartInContent;

    index = skipWhitespaceInString(content, index);

    let expression = "";
    let valueEndInContent = index;

    if (content[index] === "=") {
      index += 1;
      index = skipWhitespaceInString(content, index);
      const valueResult = parseAttributeValue(content, index);
      expression = valueResult.value;
      valueEndInContent = valueResult.end;
      index = valueResult.end;
    }

    const eventName = extractEventName(name);
    if (eventName !== undefined && expression !== "") {
      const attributeStart = attrStartOffset - 1;
      const attributeEnd = start + 1 + valueEndInContent;
      bindings.push({
        eventName,
        expression,
        start: start + 1 + nameStart,
        end: attributeEnd,
        attributeStart,
        attributeEnd,
      });
    }

    index = skipWhitespaceInString(content, index);
  }

  return { bindings, end: tagEnd + 1 };
}

function findTagEnd(html: string, start: number): number {
  let index = start + 1;
  let inString: string | undefined;

  while (index < html.length) {
    const char = html[index];

    if (inString !== undefined) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === inString) {
        inString = undefined;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      index += 1;
      continue;
    }

    if (char === ">") {
      return index;
    }

    index += 1;
  }

  return -1;
}

function skipWhitespaceInString(content: string, start: number): number {
  let index = start;
  while (index < content.length && /\s/.test(content[index]!)) {
    index += 1;
  }
  return index;
}

function parseAttributeValue(
  content: string,
  start: number,
): { value: string; end: number } {
  const quote = content[start];
  if (quote === '"' || quote === "'" || quote === "`") {
    let index = start + 1;
    let value = "";
    while (index < content.length) {
      const char = content[index];
      if (char === "\\") {
        value += content[index + 1] ?? char;
        index += 2;
        continue;
      }
      if (char === quote) {
        return { value, end: index + 1 };
      }
      value += char;
      index += 1;
    }
    return { value, end: index };
  }

  let index = start;
  let value = "";
  while (index < content.length && !/[\s>]/.test(content[index]!)) {
    value += content[index];
    index += 1;
  }
  return { value, end: index };
}

function extractEventName(name: string): string | undefined {
  if (!name.startsWith("(") || !name.endsWith(")")) return undefined;
  const inner = name.slice(1, -1);
  if (!EVENT_NAME_RE.test(inner)) return undefined;
  return inner;
}

export function parseHandlerExpression(expression: string): HandlerCall {
  const source = expression.trim();
  const { name, argsSource, argsStart } = parseCallShape(source);
  const args =
    argsSource === "" ? [] : parseArgumentList(argsSource, argsStart);

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
      `Flowmark event handler must be a function call, got "${source}".`,
    );
  }
  index = readIdentifier(source, index);
  const name = source.slice(nameStart, index);
  index = skipWhitespace(source, index);

  if (source[index] !== "(") {
    throw new Error(
      `Flowmark event handler "${name}" must be called with parentheses.`,
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
      `Flowmark event handler "${name}" has unbalanced parentheses.`,
    );
  }

  const argsSource = source.slice(argsStart, index);
  index += 1; // skip closing )
  index = skipWhitespace(source, index);

  if (index !== source.length) {
    throw new Error(
      `Flowmark event handler "${name}" has unexpected trailing content: "${source.slice(index)}".`,
    );
  }

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
        `Flowmark event handler arguments must be separated by commas, got "${argsSource.slice(index)}".`,
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
      `Flowmark event handler argument template literals are not supported at ${offset}.`,
    );
  }

  if (char === "[" || char === "{" || char === "(") {
    throw new Error(
      `Flowmark event handler argument must be a simple literal or $event/$el at ${offset}.`,
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
      `Flowmark event handler argument "${identifier}" is not supported at ${offset}.`,
    );
  }

  throw new Error(
    `Flowmark event handler argument is invalid at ${offset}: "${source[start]}".`,
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

    const { parameters, end: paramsEnd } = parseParameterList(
      frontmatter,
      index,
    );
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
        `Flowmark event handler destructured parameters are not supported.`,
      );
    }

    if (!isIdentifierStart(source[index])) {
      throw new Error(
        `Flowmark event handler parameter list is invalid at ${index}.`,
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
        `Flowmark event handler parameter list is invalid at ${index}.`,
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
    if (RESERVED_WORDS.has(name)) continue;
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
