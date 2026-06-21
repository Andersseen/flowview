import { createHash } from "node:crypto";
import flowmarkVite, {
  compileFlowmark,
  type FlowmarkViteOptions,
} from "@flowmark/vite";
import type { AstroIntegration } from "astro";
import type { Plugin } from "vite";

export interface FlowmarkAstroOptions extends FlowmarkViteOptions {}

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

const VIRTUAL_PREFIX = "virtual:flowmark-astro/";
const RESOLVED_VIRTUAL_PREFIX = "\0" + VIRTUAL_PREFIX;

export default function flowmark(
  options: FlowmarkAstroOptions = {},
): AstroIntegration {
  return {
    name: "@flowmark/astro",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [flowmarkVite(options), flowmarkAstroPlugin(options)],
          },
        });
      },
    },
  };
}

function flowmarkAstroPlugin(options: FlowmarkAstroOptions): Plugin {
  const runtimeImport = options.runtimeImport ?? "@flowmark/runtime";
  const compilerPath = options.compilerPath ?? "flowmark";
  const virtualModules = new Map<string, VirtualTemplate>();
  const virtualIdsByFile = new Map<string, Set<string>>();

  return {
    name: "@flowmark/astro:embedded",
    enforce: "pre",

    configResolved(config) {
      const plugins = config.plugins as Plugin[];
      const ownIndex = plugins.findIndex(
        (plugin) => plugin.name === "@flowmark/astro:embedded",
      );
      const astroIndex = plugins.findIndex(
        (plugin) => plugin.name === "astro:build",
      );

      if (ownIndex > astroIndex && astroIndex !== -1) {
        const [plugin] = plugins.splice(ownIndex, 1);
        if (plugin) {
          plugins.splice(astroIndex, 0, plugin);
        }
      }
    },

    resolveId(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        return RESOLVED_VIRTUAL_PREFIX + id.slice(VIRTUAL_PREFIX.length);
      }

      return null;
    },

    load(id) {
      if (!id.startsWith(RESOLVED_VIRTUAL_PREFIX)) {
        return null;
      }

      const publicId =
        VIRTUAL_PREFIX + id.slice(RESOLVED_VIRTUAL_PREFIX.length);
      const template = virtualModules.get(publicId);

      if (template === undefined) {
        throw new Error(`Missing Flowmark virtual module: ${publicId}`);
      }

      return compileFlowmark(template.source, {
        filename: template.filename,
        lineOffset: template.lineOffset,
        runtimeImport,
        compilerPath,
      });
    },

    transform(code, id) {
      const cleanId = stripQuery(id);

      if (!cleanId.endsWith(".astro") || !code.includes("flowmark")) {
        return null;
      }

      const result = transformAstroSource(
        code,
        cleanId,
        virtualModules,
        virtualIdsByFile,
      );
      if (result === null) {
        return null;
      }

      return {
        code: result,
        map: null,
      };
    },
  };
}

function transformAstroSource(
  code: string,
  filename: string,
  virtualModules: Map<string, VirtualTemplate>,
  virtualIdsByFile: Map<string, Set<string>>,
): string | null {
  const templates = findEmbeddedTemplates(code);

  if (templates.length === 0) {
    return null;
  }

  const hash = createHash("sha256").update(filename).digest("hex").slice(0, 12);
  const imports: string[] = [];
  const previousIds = virtualIdsByFile.get(filename);
  previousIds?.forEach((id) => virtualModules.delete(id));
  const currentIds = new Set<string>();
  let transformed = "";
  let cursor = 0;

  templates.forEach((template, index) => {
    const renderName = `__flowmarkRender${index}`;
    const contentHash = createHash("sha256")
      .update(template.source)
      .digest("hex")
      .slice(0, 12);
    const virtualId = `${VIRTUAL_PREFIX}${hash}/${index}-${contentHash}.js`;
    virtualModules.set(virtualId, {
      source: template.source,
      filename,
      lineOffset: template.lineOffset,
    });
    currentIds.add(virtualId);
    imports.push(`import { render as ${renderName} } from "${virtualId}";`);

    transformed += code.slice(cursor, template.start);
    transformed += `<Fragment set:html={${renderName}(${template.contextExpression})} />`;
    cursor = template.end;
  });

  transformed += code.slice(cursor);
  virtualIdsByFile.set(filename, currentIds);

  return injectFrontmatter(transformed, imports.join("\n"));
}

function findEmbeddedTemplates(code: string): EmbeddedTemplate[] {
  const templates: EmbeddedTemplate[] = [];
  let cursor = findFrontmatterEnd(code);

  while (cursor < code.length) {
    const openStart = findNextTemplateOpen(code, cursor);
    if (openStart === -1) {
      break;
    }

    const openEnd = findTagEnd(code, openStart);
    if (openEnd === -1) {
      break;
    }

    const openTag = code.slice(openStart, openEnd + 1);
    if (!hasBooleanAttribute(openTag, "flowmark")) {
      cursor = openEnd + 1;
      continue;
    }

    const contextExpression = readBracedAttribute(openTag, "context");
    if (contextExpression === null || contextExpression.length === 0) {
      throw new Error(
        "Flowmark embedded templates require a non-empty context={...} attribute.",
      );
    }

    const closeStart = findMatchingTemplateClose(code, openEnd + 1);
    if (closeStart === -1) {
      throw new Error("Flowmark embedded template is missing </template>.");
    }

    const closeTagEnd = findTagEnd(code, closeStart);
    if (closeTagEnd === -1) {
      throw new Error("Flowmark embedded template has an invalid closing tag.");
    }
    const closeEnd = closeTagEnd + 1;
    templates.push({
      source: code.slice(openEnd + 1, closeStart),
      contextExpression,
      start: openStart,
      end: closeEnd,
      lineOffset: countNewlines(code, 0, openEnd + 1),
    });
    cursor = closeEnd;
  }

  return templates;
}

function findFrontmatterEnd(code: string): number {
  const closingFence = findFrontmatterClose(code);
  return closingFence === -1 ? 0 : closingFence + "---".length;
}

function findNextTemplateOpen(code: string, start: number): number {
  let cursor = start;

  while (cursor < code.length) {
    const tagStart = code.indexOf("<", cursor);
    if (tagStart === -1) return -1;

    if (code.startsWith("<!--", tagStart)) {
      const commentEnd = code.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) return -1;
      cursor = commentEnd + 3;
      continue;
    }

    const rawTextTag = ["script", "style"].find(
      (name) =>
        code.startsWith(`<${name}`, tagStart) &&
        isTagNameBoundary(code[tagStart + name.length + 1]),
    );
    if (rawTextTag !== undefined) {
      const closeStart = code.indexOf(`</${rawTextTag}>`, tagStart + 1);
      if (closeStart === -1) return -1;
      cursor = closeStart + rawTextTag.length + 3;
      continue;
    }

    if (
      code.startsWith("<template", tagStart) &&
      isTagNameBoundary(code[tagStart + "<template".length])
    ) {
      return tagStart;
    }
    cursor = tagStart + 1;
  }

  return -1;
}

function findMatchingTemplateClose(code: string, start: number): number {
  let cursor = start;
  let depth = 1;

  while (cursor < code.length) {
    const tagStart = code.indexOf("<", cursor);
    if (tagStart === -1) return -1;

    if (code.startsWith("<!--", tagStart)) {
      const commentEnd = code.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) return -1;
      cursor = commentEnd + 3;
      continue;
    }

    const rawTextTag = ["script", "style"].find(
      (name) =>
        code.startsWith(`<${name}`, tagStart) &&
        isTagNameBoundary(code[tagStart + name.length + 1]),
    );
    if (rawTextTag !== undefined) {
      const closeStart = code.indexOf(`</${rawTextTag}>`, tagStart + 1);
      if (closeStart === -1) return -1;
      cursor = closeStart + rawTextTag.length + 3;
      continue;
    }

    if (
      code.startsWith("<template", tagStart) &&
      isTagNameBoundary(code[tagStart + "<template".length])
    ) {
      const tagEnd = findTagEnd(code, tagStart);
      if (tagEnd === -1) return -1;
      depth += 1;
      cursor = tagEnd + 1;
      continue;
    }

    if (
      code.startsWith("</template", tagStart) &&
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

function findTagEnd(code: string, start: number): number {
  let quote: string | null = null;
  let braceDepth = 0;

  for (let index = start; index < code.length; index += 1) {
    const character = code[index];

    if (quote !== null) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === ">" && braceDepth === 0) {
      return index;
    }
  }

  return -1;
}

function hasBooleanAttribute(tag: string, name: string): boolean {
  const pattern = new RegExp(`(?:^|\\s)${name}(?:\\s|=|>|$)`);
  return pattern.test(tag);
}

function readBracedAttribute(tag: string, name: string): string | null {
  const attributeStart = tag.search(new RegExp(`(?:^|\\s)${name}\\s*=\\s*\\{`));
  if (attributeStart === -1) {
    return null;
  }

  const equalsIndex = tag.indexOf("=", attributeStart);
  const braceStart = tag.indexOf("{", equalsIndex);
  let depth = 0;
  let quote: string | null = null;

  for (let index = braceStart; index < tag.length; index += 1) {
    const character = tag[index];

    if (quote !== null) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return tag.slice(braceStart + 1, index).trim();
      }
    }
  }

  throw new Error(`Unclosed ${name}={...} attribute in Flowmark template.`);
}

function injectFrontmatter(code: string, content: string): string {
  const closingFence = findFrontmatterClose(code);

  if (closingFence !== -1) {
    return `${code.slice(0, closingFence)}${content}\n${code.slice(closingFence)}`;
  }

  return `---\n${content}\n---\n\n${code}`;
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
    if (code.slice(lineStart, end).trim() === "---") {
      return lineStart;
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  return -1;
}

function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}
