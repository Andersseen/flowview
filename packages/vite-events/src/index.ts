import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  applyTemplateEdits,
  compileScriptEvents,
  findEventBindings,
  FlowviewDomError,
  hashScope,
  type TemplateEdit,
} from "@flowview/events";
import type { Plugin } from "vite";
import {
  findScriptFlowviewBlocks,
  FlowviewViteEventsParseError,
  type ScriptFlowviewBlock,
} from "./parser.js";

export interface FlowviewViteEventsOptions {
  runtimeImport?: string;
}

export interface CompileFlowviewEventsOptions {
  filename: string;
  runtimeImport?: string;
}

export interface CompileFlowviewEventsResult {
  /** `.flow` source with bindings rewritten to `data-flow-on-*` attributes and
   * the `<script data-flowview>` element removed. */
  code: string;
  /** Script body (handler declarations + `registerFlowHandlers` call) served
   * by this file's virtual events module. */
  script: string;
}

export class FlowviewViteEventsError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "FlowviewViteEventsError";
  }
}

const VIRTUAL_PREFIX = "virtual:flowview-events/";
const RESOLVED_VIRTUAL_PREFIX = "\0" + VIRTUAL_PREFIX;
const VIRTUAL_SUFFIX = ".ts";

export default function flowviewEvents(
  options: FlowviewViteEventsOptions = {},
): Plugin {
  const runtimeImport = options.runtimeImport ?? "@flowview/events/runtime";
  let root = process.cwd();

  return {
    name: "@flowview/vite-events",
    enforce: "pre",

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        return RESOLVED_VIRTUAL_PREFIX + id.slice(VIRTUAL_PREFIX.length);
      }
      return null;
    },

    load(id) {
      if (!id.startsWith(RESOLVED_VIRTUAL_PREFIX)) return null;

      const filePath = virtualIdToFilePath(id, root);
      const source = readFileSync(filePath, "utf8");

      try {
        const compiled = compileFlowviewEvents(source, {
          filename: filePath,
          runtimeImport,
        });
        return compiled?.script ?? "";
      } catch (error) {
        const located = toLocatedError(error, filePath, source);
        if (typeof this.error === "function") this.error(located);
        throw located;
      }
    },

    transform(code, id) {
      const filename = stripQuery(id);
      if (!filename.endsWith(".flow")) return null;

      try {
        const compiled = compileFlowviewEvents(code, {
          filename,
          runtimeImport,
        });
        if (compiled === null) return null;
        return { code: compiled.code, map: null };
      } catch (error) {
        const located = toLocatedError(error, filename, code);
        if (typeof this.error === "function") this.error(located);
        throw located;
      }
    },

    handleHotUpdate({ file, server, modules }) {
      if (!file.endsWith(".flow")) return;

      const virtualId = RESOLVED_VIRTUAL_PREFIX + toVirtualPath(file, root);
      const virtualModule = server.moduleGraph.getModuleById(virtualId);
      if (virtualModule === undefined) return;

      server.moduleGraph.invalidateModule(virtualModule);
      return [...modules, virtualModule];
    },
  };
}

/**
 * Rewrites `(event)="handler(...)"` bindings in `source` to `data-flow-on-*`
 * attributes and strips the `<script data-flowview>` element, returning its
 * compiled content separately for the caller to serve as a virtual module.
 * Returns `null` when `source` has no event bindings at all.
 */
export function compileFlowviewEvents(
  source: string,
  options: CompileFlowviewEventsOptions,
): CompileFlowviewEventsResult | null {
  if (findEventBindings(source).length === 0) return null;

  const runtimeImport = options.runtimeImport ?? "@flowview/events/runtime";
  const { filename } = options;

  let blocks: ScriptFlowviewBlock[];
  try {
    blocks = findScriptFlowviewBlocks(source);
  } catch (error) {
    if (error instanceof FlowviewViteEventsParseError) {
      throw new FlowviewViteEventsError(error.message, error.offset);
    }
    throw error;
  }

  if (blocks.length > 1) {
    throw new FlowviewViteEventsError(
      "At most one <script data-flowview> block is allowed per file.",
      blocks[1]!.elementStart,
    );
  }

  if (blocks.length === 0) {
    throw new FlowviewViteEventsError(
      "flowview Events bindings were found but no <script data-flowview> " +
        "block declares their handlers.",
      0,
    );
  }

  const block = blocks[0]!;
  const scope = hashScope(filename);

  const result = compileScriptEvents({
    filename,
    scope,
    template: source,
    scriptOffset: block.scriptContentStart,
    scriptSource: block.scriptSource,
    runtimeImport,
  });

  const edits: TemplateEdit[] = [
    ...result.templateEdits,
    { start: block.elementStart, end: block.elementEnd, replacement: "" },
  ];

  return {
    code: applyTemplateEdits(source, edits),
    script: block.scriptSource + result.scriptAppend,
  };
}

interface LocatedError {
  message: string;
  id: string;
  loc: { line: number; column: number };
}

function toLocatedError(
  error: unknown,
  filename: string,
  code: string,
): LocatedError {
  if (error instanceof FlowviewViteEventsError) {
    return {
      message: error.message,
      id: filename,
      loc: lineAndColumn(code, error.offset),
    };
  }
  if (error instanceof FlowviewDomError) {
    const first = error.diagnostics[0];
    const message = error.diagnostics.map((d) => d.message).join("\n");
    return {
      message,
      id: filename,
      loc: first
        ? { line: first.line, column: first.column }
        : { line: 1, column: 1 },
    };
  }
  throw error;
}

function toVirtualPath(filePath: string, root: string): string {
  const relativePath = relative(root, filePath).split(sep).join("/");
  return relativePath + VIRTUAL_SUFFIX;
}

function virtualIdToFilePath(id: string, root: string): string {
  const relativePath = id.slice(
    RESOLVED_VIRTUAL_PREFIX.length,
    -VIRTUAL_SUFFIX.length,
  );
  return resolve(root, relativePath);
}

function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
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
