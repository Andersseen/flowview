import { parse } from "@astrojs/compiler/sync";
import type {
  Node as AstroNode,
  ParentLikeNode,
  TagLikeNode,
} from "@astrojs/compiler/types";
import { createHash } from "node:crypto";
import flowviewVite, {
  compileFlowview,
  resolveCompilerPath,
  type FlowviewViteOptions,
} from "@flowview/vite";
import type { AstroIntegration } from "astro";
import MagicString from "magic-string";
import type { Plugin } from "vite";

export interface FlowviewAstroOptions extends FlowviewViteOptions {}

interface EmbeddedTemplate {
  source: string;
  contextExpression: string;
  start: number;
  end: number;
  lineOffset: number;
}

interface VirtualTemplate {
  source: string;
  filename: string;
  lineOffset: number;
}

class FlowviewAstroError extends Error {
  readonly loc: { line: number; column: number };

  constructor(
    message: string,
    readonly filename: string,
    offset: number,
    code: string,
  ) {
    super(message);
    this.name = "FlowviewAstroError";
    const { line, column } = lineAndColumn(code, offset);
    this.loc = { line, column };
  }
}

const VIRTUAL_PREFIX = "virtual:flowview-astro/";
const RESOLVED_VIRTUAL_PREFIX = "\0" + VIRTUAL_PREFIX;

export default function flowview(
  options: FlowviewAstroOptions = {},
): AstroIntegration {
  return {
    name: "@flowview/astro",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [flowviewVite(options), flowviewAstroPlugin(options)],
          },
        });
      },
    },
  };
}

function flowviewAstroPlugin(options: FlowviewAstroOptions): Plugin {
  const runtimeImport = options.runtimeImport ?? "@flowview/runtime";
  const compilerPath = resolveCompilerPath(options.compilerPath);
  const virtualModules = new Map<string, VirtualTemplate>();
  const virtualIdsByFile = new Map<string, Set<string>>();

  return {
    name: "@flowview/astro:embedded",
    enforce: "pre",

    configResolved(config) {
      const plugins = config.plugins as Plugin[];
      const ownIndex = plugins.findIndex(
        (plugin) => plugin.name === "@flowview/astro:embedded",
      );
      const astroIndex = plugins.findIndex(
        (plugin) => plugin.name === "astro:build",
      );

      if (ownIndex > astroIndex && astroIndex !== -1) {
        const [plugin] = plugins.splice(ownIndex, 1);
        if (plugin) plugins.splice(astroIndex, 0, plugin);
      }
    },

    resolveId(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        return RESOLVED_VIRTUAL_PREFIX + id.slice(VIRTUAL_PREFIX.length);
      }
      return null;
    },

    async load(id) {
      if (!id.startsWith(RESOLVED_VIRTUAL_PREFIX)) return null;

      const publicId =
        VIRTUAL_PREFIX + id.slice(RESOLVED_VIRTUAL_PREFIX.length);
      const template = virtualModules.get(publicId);
      if (template === undefined) {
        throw new Error(`Missing flowview virtual module: ${publicId}`);
      }

      const { code } = await compileFlowview(template.source, {
        filename: template.filename,
        lineOffset: template.lineOffset,
        runtimeImport,
        compilerPath,
      });
      return code;
    },

    transform(code, id) {
      const cleanId = stripQuery(id);
      if (!cleanId.endsWith(".astro") || !code.includes("flowview")) {
        return null;
      }

      try {
        return transformAstroSource(
          code,
          cleanId,
          virtualModules,
          virtualIdsByFile,
        );
      } catch (error) {
        if (error instanceof FlowviewAstroError) {
          const locatedError = {
            message: error.message,
            id: cleanId,
            loc: error.loc,
          };
          if (typeof this.error === "function") {
            this.error(locatedError);
          }
          throw locatedError;
        }
        throw error;
      }
    },
  };
}

function transformAstroSource(
  code: string,
  filename: string,
  virtualModules: Map<string, VirtualTemplate>,
  virtualIdsByFile: Map<string, Set<string>>,
): { code: string; map: ReturnType<MagicString["generateMap"]> } | null {
  const templates = findEmbeddedTemplates(code, filename);
  if (templates.length === 0) return null;

  const fileHash = createHash("sha256")
    .update(filename)
    .digest("hex")
    .slice(0, 12);
  const imports: string[] = [];
  const previousIds = virtualIdsByFile.get(filename);
  previousIds?.forEach((id) => virtualModules.delete(id));
  const currentIds = new Set<string>();
  const transformed = new MagicString(code);

  templates.forEach((template, index) => {
    const renderName = `__flowviewRender${index}`;
    const contentHash = createHash("sha256")
      .update(template.source)
      .digest("hex")
      .slice(0, 12);
    const virtualId = `${VIRTUAL_PREFIX}${fileHash}/${index}-${contentHash}.js`;
    virtualModules.set(virtualId, {
      source: template.source,
      filename,
      lineOffset: template.lineOffset,
    });
    currentIds.add(virtualId);
    imports.push(`import { render as ${renderName} } from "${virtualId}";`);
    transformed.overwrite(
      template.start,
      template.end,
      `<Fragment set:html={${renderName}(${template.contextExpression})} />`,
    );
  });

  virtualIdsByFile.set(filename, currentIds);
  injectFrontmatter(transformed, code, imports.join("\n"));

  return {
    code: transformed.toString(),
    map: transformed.generateMap({
      source: filename,
      includeContent: true,
      hires: true,
    }),
  };
}

function findEmbeddedTemplates(
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

    const firstKnownOffset =
      flowviewAttribute.position?.start.offset ??
      node.position?.start.offset ??
      0;
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
      end: closeTagEnd + 1,
      lineOffset: countNewlines(code, 0, openEnd + 1),
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

function injectFrontmatter(
  transformed: MagicString,
  original: string,
  content: string,
): void {
  const closingFence = findFrontmatterClose(original);
  if (closingFence !== -1) {
    transformed.appendLeft(closingFence, `${content}\n`);
  } else {
    transformed.prepend(`---\n${content}\n---\n\n`);
  }
}

function findFrontmatterClose(code: string): number {
  const firstLineEnd = code.indexOf("\n");
  if (firstLineEnd === -1 || code.slice(0, firstLineEnd).trim() !== "---") {
    return -1;
  }

  let lineStart = firstLineEnd + 1;
  while (lineStart <= code.length) {
    const lineEnd = code.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? code.length : lineEnd;
    if (code.slice(lineStart, end).trim() === "---") return lineStart;
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
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

function lineAndColumn(
  source: string,
  offset: number,
): { line: number; column: number } {
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

function startsWithIgnoreCase(
  value: string,
  prefix: string,
  start = 0,
): boolean {
  return (
    value.slice(start, start + prefix.length).toLowerCase() ===
    prefix.toLowerCase()
  );
}

function findCaseInsensitive(value: string, search: string, start = 0): number {
  const lowerSearch = search.toLowerCase();
  for (let index = start; index <= value.length - search.length; index += 1) {
    if (
      value.slice(index, index + search.length).toLowerCase() === lowerSearch
    ) {
      return index;
    }
  }
  return -1;
}

function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}
