import ts from "typescript";
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
  isAsync: boolean;
}

export interface ParsedFrontmatter {
  functions: FrontmatterFunction[];
}

const EVENT_NAME_RE = /^[\w-]+$/;

const FRONTMATTER_FILENAME = "frontmatter.ts";

function parseFrontmatterSource(frontmatter: string): ts.SourceFile {
  return ts.createSourceFile(
    FRONTMATTER_FILENAME,
    frontmatter,
    ts.ScriptTarget.Latest,
    true,
  );
}

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
  const sourceFile = parseFrontmatterSource(frontmatter);
  const functions: FrontmatterFunction[] = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      statement.name === undefined ||
      statement.body === undefined
    ) {
      continue;
    }

    const parameters = statement.parameters.map((param) =>
      renderClientParameter(param, sourceFile),
    );
    const bodyText = statement.body.getText(sourceFile);
    const isAsync =
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
      ) ?? false;

    functions.push({
      name: statement.name.text,
      parameters,
      source: statement.getText(sourceFile),
      body: bodyText.slice(1, -1),
      offset: statement.getStart(sourceFile),
      isAsync,
    });
  }

  return { functions };
}

function renderClientParameter(
  param: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
): string {
  if (!ts.isIdentifier(param.name)) {
    throw new Error(
      `Flowmark event handler destructured parameters are not supported.`,
    );
  }

  const rest = param.dotDotDotToken === undefined ? "" : "...";
  const name = param.name.text;
  const initializer =
    param.initializer === undefined
      ? ""
      : ` = ${param.initializer.getText(sourceFile)}`;
  return `${rest}${name}${initializer}`;
}

export function findUnsupportedHandlerNames(frontmatter: string): string[] {
  const sourceFile = parseFrontmatterSource(frontmatter);
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        names.add(declaration.name.text);
      }
    }
  }

  return Array.from(names);
}

/**
 * Reports, per handler, the identifiers that resolve to frontmatter bindings
 * declared outside the handler itself. Those values live on the server, so a
 * handler that references them cannot move to the client.
 *
 * Identifiers that do not resolve inside the frontmatter (browser globals such
 * as `IntersectionObserver`, `alert`, or custom elements) are allowed: they
 * are resolved by the browser at runtime.
 */
export function analyzeAllCaptures(
  frontmatter: string,
  functions: FrontmatterFunction[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (functions.length === 0) return result;

  const sourceFile = parseFrontmatterSource(frontmatter);
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion, ...args) => {
    if (fileName === FRONTMATTER_FILENAME) return sourceFile;
    return originalGetSourceFile(fileName, languageVersion, ...args);
  };

  const program = ts.createProgram([FRONTMATTER_FILENAME], options, host);
  const checker = program.getTypeChecker();

  for (const func of functions) {
    const declaration = findTopLevelFunction(sourceFile, func.name);
    if (declaration === undefined) {
      result.set(func.name, []);
      continue;
    }

    const captures = new Set<string>();
    const functionStart = declaration.getStart(sourceFile);
    const functionEnd = declaration.getEnd();

    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && isReferenceIdentifier(node)) {
        const declarations =
          checker.getSymbolAtLocation(node)?.getDeclarations() ?? [];
        const capturesFrontmatter = declarations.some(
          (decl) =>
            decl.getSourceFile() === sourceFile &&
            !(
              decl.getStart(sourceFile) >= functionStart &&
              decl.getEnd() <= functionEnd
            ),
        );
        if (capturesFrontmatter) {
          captures.add(node.text);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(declaration);
    result.set(func.name, Array.from(captures));
  }

  return result;
}

function findTopLevelFunction(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration | undefined {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.name.text === name
    ) {
      return statement;
    }
  }
  return undefined;
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) return true;

  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return false;
  }
  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    return false;
  }
  if (ts.isPropertySignature(parent) && parent.name === node) {
    return false;
  }
  if (ts.isQualifiedName(parent)) {
    return false;
  }
  if (
    ts.isTypeReferenceNode(parent) ||
    ts.isTypeQueryNode(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isModuleDeclaration(parent)
  ) {
    return false;
  }
  if (ts.isImportClause(parent) && parent.name === node) {
    return false;
  }
  if (ts.isImportSpecifier(parent) && parent.name === node) {
    return false;
  }
  if (
    ts.isExportSpecifier(parent) &&
    (parent.name === node || parent.propertyName === node)
  ) {
    return false;
  }
  if (
    (ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isMethodDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (ts.isParameter(parent) && parent.name === node) {
    return false;
  }
  if (ts.isVariableDeclaration(parent) && parent.name === node) {
    return false;
  }
  if (ts.isBindingElement(parent) && parent.name === node) {
    return false;
  }
  if (ts.isJsxAttribute(parent) && parent.name === node) {
    return false;
  }
  if (
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxClosingElement(parent) ||
      ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === node
  ) {
    return false;
  }
  if (ts.isLabeledStatement(parent) && parent.label === node) {
    return false;
  }
  if (
    (ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) &&
    parent.label === node
  ) {
    return false;
  }
  if (ts.isMetaProperty(parent)) {
    return false;
  }

  return true;
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
