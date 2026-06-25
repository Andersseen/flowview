import { parse } from "@astrojs/compiler/sync";
import type { Node as AstroNode } from "@astrojs/compiler/types";
import {
  compileEvents,
  FlowmarkDomError,
  type CompileEventsResult,
} from "@flowmark/dom";
import type { AstroIntegration } from "astro";
import type { Plugin } from "vite";

export interface FlowmarkAstroEventsOptions {
  runtimeImport?: string;
}

class FlowmarkAstroEventsError extends Error {
  readonly loc: { line: number; column: number };

  constructor(
    message: string,
    readonly filename: string,
    offset: number,
    code: string,
  ) {
    super(message);
    this.name = "FlowmarkAstroEventsError";
    const { line, column } = lineAndColumn(code, offset);
    this.loc = { line, column };
  }
}

export default function flowmarkEvents(
  options: FlowmarkAstroEventsOptions = {},
): AstroIntegration {
  return {
    name: "@flowmark/astro-events",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [flowmarkEventsVitePlugin(options)],
          },
        });
      },
    },
  };
}

function flowmarkEventsVitePlugin(
  options: FlowmarkAstroEventsOptions,
): Plugin {
  const runtimeImport = options.runtimeImport ?? "@flowmark/dom/runtime";

  return {
    name: "@flowmark/astro-events:transform",
    enforce: "pre",

    configResolved(config) {
      const plugins = config.plugins as Plugin[];
      const ownIndex = plugins.findIndex(
        (plugin) => plugin.name === "@flowmark/astro-events:transform",
      );
      const astroIndex = plugins.findIndex(
        (plugin) => plugin.name === "astro:build",
      );

      if (ownIndex > astroIndex && astroIndex !== -1) {
        const [plugin] = plugins.splice(ownIndex, 1);
        if (plugin) plugins.splice(astroIndex, 0, plugin);
      }
    },

    transform(code, id) {
      const cleanId = stripQuery(id);
      if (!cleanId.endsWith(".astro")) return null;

      try {
        return transformAstroSource(code, cleanId, runtimeImport);
      } catch (error) {
        if (error instanceof FlowmarkAstroEventsError) {
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
        if (error instanceof FlowmarkDomError) {
          const first = error.diagnostics[0];
          if (first) {
            const message = error.diagnostics
              .map((diagnostic) => diagnostic.message)
              .join("\n");
            const locatedError = {
              message,
              id: cleanId,
              loc: { line: first.line, column: first.column },
            };
            if (typeof this.error === "function") {
              this.error(locatedError);
            }
            throw locatedError;
          }
        }
        throw error;
      }
    },
  };
}

interface TransformResult {
  code: string;
  map: null;
}

function transformAstroSource(
  code: string,
  filename: string,
  runtimeImport: string,
): TransformResult | null {
  const { ast } = parse(code, { position: true });
  const frontmatter = findFrontmatter(ast);
  if (frontmatter === undefined) return null;

  const templateStart = frontmatter.position.end.offset;
  const frontmatterSource = frontmatter.value;
  const templateSource = code.slice(templateStart);

  if (!hasEventAttribute(templateSource)) return null;

  let result: CompileEventsResult;
  try {
    result = compileEvents({
      filename,
      frontmatter: frontmatterSource,
      template: templateSource,
      runtimeImport,
    });
  } catch (error) {
    if (error instanceof FlowmarkDomError) {
      throw error;
    }
    throw new FlowmarkAstroEventsError(
      error instanceof Error ? error.message : String(error),
      filename,
      templateStart,
      code,
    );
  }

  if (result.clientModule === "") {
    return null;
  }

  const safeModule = result.clientModule.replace(/<\/script>/gi, "<\\/script>");
  const script = `<script type="module">\n${safeModule}\n</script>`;
  const transformedCode = `${code.slice(0, templateStart)}${script}\n${result.html}`;

  return {
    code: transformedCode,
    map: null,
  };
}

function findFrontmatter(ast: AstroNode): {
  value: string;
  position: { end: { offset: number } };
} | undefined {
  if (ast.type !== "root" || !("children" in ast)) return undefined;

  for (const child of ast.children) {
    if (child.type === "frontmatter") {
      return child as {
        value: string;
        position: { end: { offset: number } };
      };
    }
  }

  return undefined;
}

function hasEventAttribute(source: string): boolean {
  return /\s\([\w-]+\)\s*=/.test(source);
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

function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}
