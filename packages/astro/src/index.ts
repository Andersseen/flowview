import { createHash } from "node:crypto";
import { relative, sep } from "node:path";
import flowviewVite, {
  compileFlowview,
  resolveCompilerPath,
  type FlowviewViteOptions,
} from "@flowview/vite";
import type { AstroIntegration } from "astro";
import MagicString from "magic-string";
import type { Plugin } from "vite";
import {
  findEmbeddedTemplates,
  FlowviewAstroError,
  type EmbeddedTemplate,
} from "./embedded-regions.js";

export interface FlowviewAstroOptions extends FlowviewViteOptions {}

interface VirtualTemplate {
  source: string;
  filename: string;
  lineOffset: number;
  columnOffset: number;
  hostSource: string;
  sourceMapFilename: string;
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
  let projectRoot = process.cwd();

  return {
    name: "@flowview/astro:embedded",
    enforce: "pre",

    configResolved(config) {
      projectRoot = config.root;
      const plugins = config.plugins as Plugin[];
      const ownIndex = plugins.findIndex(
        (plugin) => plugin.name === "@flowview/astro:embedded",
      );
      const astroIndex = plugins.findIndex(
        (plugin) => plugin.name === "astro:build",
      );
      const eventsIndex = plugins.findIndex(
        (plugin) => plugin.name === "@flowview/astro-events:transform",
      );

      if (ownIndex > astroIndex && astroIndex !== -1) {
        const [plugin] = plugins.splice(ownIndex, 1);
        if (plugin) plugins.splice(astroIndex, 0, plugin);
      }
      const updatedOwnIndex = plugins.findIndex(
        (plugin) => plugin.name === "@flowview/astro:embedded",
      );
      const updatedEventsIndex = plugins.findIndex(
        (plugin) => plugin.name === "@flowview/astro-events:transform",
      );
      if (
        eventsIndex !== -1 &&
        updatedEventsIndex !== -1 &&
        updatedOwnIndex !== -1 &&
        updatedOwnIndex < updatedEventsIndex
      ) {
        const [plugin] = plugins.splice(updatedOwnIndex, 1);
        if (plugin) plugins.splice(updatedEventsIndex, 0, plugin);
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

      const { code, map } = await compileFlowview(template.source, {
        filename: template.filename,
        lineOffset: template.lineOffset,
        runtimeImport,
        compilerPath,
        sourceMapFilename: template.sourceMapFilename,
        sourceMapSourceContent: template.hostSource,
        sourceMapColumnOffset: template.columnOffset,
      });
      return { code, map };
    },

    transform: {
      order: "pre",
      handler(code, id) {
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
            projectRoot,
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
    },
  };
}

function transformAstroSource(
  code: string,
  filename: string,
  virtualModules: Map<string, VirtualTemplate>,
  virtualIdsByFile: Map<string, Set<string>>,
  projectRoot: string,
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
      columnOffset: template.columnOffset,
      hostSource: code,
      sourceMapFilename: relative(projectRoot, filename).split(sep).join("/"),
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

function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}
