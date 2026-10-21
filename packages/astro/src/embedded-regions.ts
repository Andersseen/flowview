import { parse } from "@astrojs/compiler/sync";
import type {
  Node as AstroNode,
  ParentLikeNode,
  TagLikeNode,
} from "@astrojs/compiler/types";

export interface EmbeddedTemplate {
  source: string;
  contextExpression: string;
  start: number;
  bodyStart: number;
  end: number;
  lineOffset: number;
  columnOffset: number;
}

export class FlowviewAstroError extends Error {
  readonly loc: { line: number; column: number };

  constructor(
    message: string,
    readonly filename: string,
    offset: number,
    code: string,
  ) {
    super(message);
    this.name = "FlowviewAstroError";
    this.loc = lineAndColumn(code, offset);
  }
}

/** Find embedded FlowView templates using the same Astro AST and wrapper checks as the transform. */
export function findEmbeddedTemplates(
  code: string,
  filename: string,
): EmbeddedTemplate[] {
  const { ast } = parse(code, { position: true });
  const templates: EmbeddedTemplate[] = [];

  visitAstroNodes(ast, (node) => {
    if (!isTagNode(node) || node.name !== "template") return true;
    const flowviewAttribute = node.attributes.find(
      (attribute) => attribute.name === "flowview",
    );
    if (!flowviewAttribute) return true;

    const firstKnownOffset = toCodeUnitOffset(
      code,
      flowviewAttribute.position?.start.offset ??
        node.position?.start.offset ??
        0,
    );
    const openStart = code.lastIndexOf("<", firstKnownOffset);
    const openEnd = findTagEnd(code, openStart);
    if (openStart === -1 || openEnd === -1) {
      throw new FlowviewAstroError(
        "flowview embedded template has an invalid opening tag.",
        filename,
        firstKnownOffset,
        code,
      );
    }

    const contextAttribute = node.attributes.find(
      (attribute) => attribute.name === "context",
    );
    const flowviewExpression =
      flowviewAttribute.kind === "expression"
        ? flowviewAttribute.value.trim()
        : "";
    const contextExpression =
      flowviewExpression !== ""
        ? flowviewExpression
        : contextAttribute?.kind === "expression"
          ? contextAttribute.value.trim()
          : "";
    if (!contextExpression) {
      throw new FlowviewAstroError(
        "flowview embedded templates require a context expression: flowview={...} or context={...}.",
        filename,
        openStart,
        code,
      );
    }
    if (flowviewExpression !== "" && contextAttribute?.kind === "expression") {
      throw new FlowviewAstroError(
        "flowview embedded templates must not combine flowview={...} with context={...}; use one of them.",
        filename,
        openStart,
        code,
      );
    }

    const closeStart = findMatchingTemplateClose(code, openEnd + 1);
    if (closeStart === -1) {
      throw new FlowviewAstroError(
        "flowview embedded template is missing </template>.",
        filename,
        openStart,
        code,
      );
    }
    const closeTagEnd = findTagEnd(code, closeStart);
    if (closeTagEnd === -1) {
      throw new FlowviewAstroError(
        "flowview embedded template has an invalid closing tag.",
        filename,
        closeStart,
        code,
      );
    }

    templates.push({
      source: code.slice(openEnd + 1, closeStart),
      contextExpression,
      start: openStart,
      bodyStart: openEnd + 1,
      end: closeTagEnd + 1,
      lineOffset: countNewlines(code, 0, openEnd + 1),
      columnOffset: openEnd + 1 - (code.lastIndexOf("\n", openEnd) + 1),
    });
    return false;
  });

  return templates.sort((left, right) => left.start - right.start);
}

function visitAstroNodes(
  root: ParentLikeNode,
  visitor: (node: AstroNode) => boolean,
): void {
  for (const child of root.children) {
    const shouldVisitChildren = visitor(child);
    if (shouldVisitChildren && "children" in child) {
      visitAstroNodes(child, visitor);
    }
  }
}

function isTagNode(node: AstroNode): node is TagLikeNode {
  return ["element", "component", "custom-element", "fragment"].includes(
    node.type,
  );
}

function findMatchingTemplateClose(code: string, start: number): number {
  let cursor = start;
  let depth = 1;
  while (cursor < code.length) {
    const tagStart = code.indexOf("<", cursor);
    if (tagStart === -1) return -1;
    if (startsWithIgnoreCase(code, "<!--", tagStart)) {
      const commentEnd = code.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) return -1;
      cursor = commentEnd + 3;
      continue;
    }
    const rawTextTag = ["script", "style"].find(
      (name) =>
        startsWithIgnoreCase(code, `<${name}`, tagStart) &&
        isTagNameBoundary(code[tagStart + name.length + 1]),
    );
    if (rawTextTag !== undefined) {
      const closeStart = findCaseInsensitive(
        code,
        `</${rawTextTag}>`,
        tagStart + 1,
      );
      if (closeStart === -1) return -1;
      cursor = closeStart + rawTextTag.length + 3;
      continue;
    }
    if (
      startsWithIgnoreCase(code, "<template", tagStart) &&
      isTagNameBoundary(code[tagStart + "<template".length])
    ) {
      const tagEnd = findTagEnd(code, tagStart);
      if (tagEnd === -1) return -1;
      depth += 1;
      cursor = tagEnd + 1;
      continue;
    }
    if (
      startsWithIgnoreCase(code, "</template", tagStart) &&
      isTagNameBoundary(code[tagStart + "</template".length])
    ) {
      const tagEnd = findTagEnd(code, tagStart);
      if (tagEnd === -1) return -1;
      depth -= 1;
      if (depth === 0) return tagStart;
      cursor = tagEnd + 1;
      continue;
    }
    cursor = tagStart + 1;
  }
  return -1;
}

function findTagEnd(code: string, start: number): number {
  let quote: string | null = null;
  let braceDepth = 0;
  for (let index = start; index < code.length; index += 1) {
    const character = code[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      braceDepth += 1;
    } else if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (character === ">" && braceDepth === 0) {
      return index;
    }
  }
  return -1;
}

function isTagNameBoundary(character: string | undefined): boolean {
  return character === undefined || /[\s/>]/.test(character);
}

function countNewlines(value: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; index += 1) {
    if (value[index] === "\n") count += 1;
  }
  return count;
}

function lineAndColumn(source: string, offset: number) {
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

function toCodeUnitOffset(source: string, byteOffset: number): number {
  let bytes = 0;
  let units = 0;
  for (const character of source) {
    if (bytes >= byteOffset) break;
    bytes += Buffer.byteLength(character, "utf8");
    units += character.length;
  }
  return units;
}

function startsWithIgnoreCase(value: string, prefix: string, start = 0) {
  return (
    value.slice(start, start + prefix.length).toLowerCase() ===
    prefix.toLowerCase()
  );
}

function findCaseInsensitive(value: string, search: string, start = 0) {
  const lowerSearch = search.toLowerCase();
  for (let index = start; index <= value.length - search.length; index += 1) {
    if (value.slice(index, index + search.length).toLowerCase() === lowerSearch)
      return index;
  }
  return -1;
}
