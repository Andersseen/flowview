import { parse } from "@astrojs/compiler/sync";
import type {
  AttributeNode,
  ElementNode,
  Node as AstroNode,
  TextNode,
} from "@astrojs/compiler/types";
import { createHash } from "node:crypto";
import MagicString, { type SourceMap } from "magic-string";
import {
  compileScriptEvents,
  findEventBindings,
  FlowmarkDomError,
  type FlowmarkDomDiagnostic,
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

function flowmarkEventsVitePlugin(options: FlowmarkAstroEventsOptions): Plugin {
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
        const result = transformAstroSource(code, cleanId, runtimeImport);
        if (result === null) return null;
        return { code: result.code, map: result.map };
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

interface TransformSourceResult {
  code: string;
  map: SourceMap | null;
}

function transformAstroSource(
  code: string,
  filename: string,
  runtimeImport: string,
): TransformSourceResult | null {
  const { ast } = parse(code, { position: true });
  const frontmatter = findFrontmatter(ast);
  if (frontmatter === undefined) return null;

  const toIndex = createByteOffsetConverter(code);
  const templateStart = toIndex(frontmatter.position.end.offset);
  const templateSource = code.slice(templateStart);

  if (findEventBindings(templateSource).length === 0) return null;

  const scriptBlocks = findScriptFlowmarkBlocks(ast, code, filename, toIndex);

  if (scriptBlocks.length > 1) {
    throw new FlowmarkAstroEventsError(
      "At most one <script data-flowmark> block is allowed per file.",
      filename,
      scriptBlocks[1]!.elementStart,
      code,
    );
  }

  if (scriptBlocks.length === 1) {
    return transformWithScriptBlock(
      code,
      filename,
      templateStart,
      templateSource,
      scriptBlocks[0]!,
      runtimeImport,
    );
  }

  throw new FlowmarkAstroEventsError(
    "Flowmark Events bindings were found but no <script data-flowmark> " +
      "block declares their handlers. Declare event handlers in a " +
      "<script data-flowmark> block; declaring them in Astro frontmatter " +
      "is no longer supported.",
    filename,
    templateStart,
    code,
  );
}

function transformWithScriptBlock(
  code: string,
  filename: string,
  templateStart: number,
  templateSource: string,
  block: ScriptFlowmarkBlock,
  runtimeImport: string,
): TransformSourceResult {
  const scope = createHash("sha256")
    .update(filename)
    .digest("hex")
    .slice(0, 12);

  let result;
  try {
    result = compileScriptEvents({
      filename,
      scope,
      template: templateSource,
      scriptOffset: block.scriptContentStart - templateStart,
      scriptSource: block.scriptSource,
      runtimeImport,
    });
  } catch (error) {
    if (error instanceof FlowmarkDomError) {
      const translated = translateDiagnostics(
        error.diagnostics,
        code,
        templateStart,
      );
      throw new FlowmarkDomError(error.message, translated);
    }
    throw error;
  }

  const s = new MagicString(code);

  for (const edit of result.templateEdits) {
    s.overwrite(
      templateStart + edit.start,
      templateStart + edit.end,
      edit.replacement,
    );
  }

  s.overwrite(block.flowmarkAttributeStart, block.flowmarkAttributeEnd, "");

  if (result.scriptAppend !== "") {
    s.appendLeft(block.scriptContentEnd, result.scriptAppend);
  }

  return {
    code: s.toString(),
    map: s.generateMap({ source: filename, includeContent: true }),
  };
}

interface ScriptFlowmarkBlock {
  elementStart: number;
  flowmarkAttributeStart: number;
  flowmarkAttributeEnd: number;
  scriptSource: string;
  scriptContentStart: number;
  scriptContentEnd: number;
}

/**
 * `@astrojs/compiler` reports positions as 0-based UTF-8 BYTE offsets, but
 * `code` is a JS string indexed in UTF-16 code units. Any multi-byte
 * character (accented letters, em dashes, emoji, …) earlier in the file
 * makes the two diverge, so every AST offset must be converted before it is
 * used to index or slice `code`.
 */
function createByteOffsetConverter(
  code: string,
): (byteOffset: number) => number {
  const buffer = Buffer.from(code, "utf8");
  return (byteOffset: number) =>
    buffer.subarray(0, byteOffset).toString("utf8").length;
}

function findScriptFlowmarkBlocks(
  ast: AstroNode,
  code: string,
  filename: string,
  toIndex: (byteOffset: number) => number,
): ScriptFlowmarkBlock[] {
  const blocks: ScriptFlowmarkBlock[] = [];

  const visit = (node: AstroNode): void => {
    if (node.type === "element" && node.name === "script") {
      const flowmarkAttribute = node.attributes.find(
        (attribute) => attribute.name === "data-flowmark",
      );
      if (flowmarkAttribute !== undefined) {
        blocks.push(
          buildScriptBlock(node, flowmarkAttribute, code, filename, toIndex),
        );
      }
    }
    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  visit(ast);
  return blocks;
}

function buildScriptBlock(
  element: ElementNode,
  flowmarkAttribute: AttributeNode,
  code: string,
  filename: string,
  toIndex: (byteOffset: number) => number,
): ScriptFlowmarkBlock {
  const elementStart = toIndex(element.position?.start.offset ?? 0);

  if (flowmarkAttribute.kind !== "empty") {
    throw new FlowmarkAstroEventsError(
      "The `data-flowmark` attribute on <script> must not have a value.",
      filename,
      flowmarkAttribute.position === undefined
        ? elementStart
        : toIndex(flowmarkAttribute.position.start.offset),
      code,
    );
  }

  const attributeStart =
    flowmarkAttribute.position === undefined
      ? elementStart
      : toIndex(flowmarkAttribute.position.start.offset);
  // Also remove the single preceding space so stripping the attribute
  // leaves `<script>` rather than `<script >`.
  const flowmarkAttributeStart =
    code[attributeStart - 1] === " " ? attributeStart - 1 : attributeStart;
  const flowmarkAttributeEnd = attributeStart + flowmarkAttribute.name.length;

  const textChild = element.children.find(
    (child): child is TextNode => child.type === "text",
  );
  const elementEnd =
    element.position?.end === undefined
      ? code.length
      : toIndex(element.position.end.offset);
  const fallbackContentEnd = Math.max(
    elementStart,
    elementEnd - "</script>".length,
  );

  return {
    elementStart,
    flowmarkAttributeStart,
    flowmarkAttributeEnd,
    scriptSource: textChild?.value ?? "",
    scriptContentStart:
      textChild?.position?.start.offset === undefined
        ? fallbackContentEnd
        : toIndex(textChild.position.start.offset),
    scriptContentEnd:
      textChild?.position?.end === undefined
        ? fallbackContentEnd
        : toIndex(textChild.position.end.offset),
  };
}

function findFrontmatter(ast: AstroNode):
  | {
      value: string;
      position: { end: { offset: number } };
    }
  | undefined {
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

function translateDiagnostics(
  diagnostics: FlowmarkDomDiagnostic[],
  source: string,
  offset: number,
): FlowmarkDomDiagnostic[] {
  const { line: baseLine, column: baseColumn } = lineAndColumn(source, offset);

  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    line: diagnostic.line === 1 ? baseLine : baseLine + diagnostic.line - 1,
    column:
      diagnostic.line === 1
        ? baseColumn + diagnostic.column - 1
        : diagnostic.column,
  }));
}

function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}
