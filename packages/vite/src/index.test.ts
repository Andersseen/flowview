import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { describe, expect, it } from "vitest";
import { build } from "vite";
import flowview, { compileFlowview, resolveCompilerPath } from "./index";

const compilerPath = fileURLToPath(
  new URL("../../../target/debug/flowview", import.meta.url),
);

describe("compileFlowview", () => {
  // @spec SPEC-HTML-083
  it("discovers the workspace compiler without configuration", () => {
    expect(resolveCompilerPath()).toBe(compilerPath);
  });

  // @spec SPEC-HTML-033 SPEC-HTML-034
  it("compiles stdin without temporary files", async () => {
    const { code, map } = await compileFlowview(
      "<p>Hello {{ context.name }}</p>",
      {
        filename: "greeting.flow",
        runtimeImport: "@flowview/runtime",
        compilerPath,
      },
    );

    expect(code).toContain("output += '<p';");
    expect(code).toContain("output += '>';");
    expect(code).toContain("output += 'Hello ';");
    expect(code).toContain("renderValue(context.name)");
    expect(map.sources).toEqual(["greeting.flow"]);
    expect(map.sourcesContent).toEqual(["<p>Hello {{ context.name }}</p>"]);
    expect(JSON.stringify(map)).not.toMatch(
      /\/Users\/|target\/debug\/|packages\/compiler\/pkg\//,
    );
    expect(originalAt(map, code, "context.name")).toMatchObject({
      source: "greeting.flow",
      line: 1,
      column: 12,
    });
  });

  // @spec SPEC-HTML-037
  it("returns equivalent maps from native and bundled WASM compilers", async () => {
    const source = "@for (item of context.items) { {{ item.title }} }";
    const native = await compileFlowview(source, {
      filename: "src/list.flow",
      runtimeImport: "@flowview/runtime",
      compilerPath,
      sourceMapFilename: "src/list.flow",
    });
    const wasm = await compileFlowview(source, {
      filename: "src/list.flow",
      runtimeImport: "@flowview/runtime",
      compilerPath: "",
      sourceMapFilename: "src/list.flow",
    });

    expect(native.code).toBe(wasm.code);
    expect(native.map.sources).toEqual(wasm.map.sources);
    expect(originalAt(native.map, native.code, "context.items")).toEqual(
      originalAt(wasm.map, wasm.code, "context.items"),
    );
    expect(originalAt(wasm.map, wasm.code, "item.title")).toMatchObject({
      source: "src/list.flow",
      line: 1,
      column: 34,
    });
  });

  // @spec SPEC-HTML-037 SPEC-HTML-079
  it("returns the compiler map from the Vite transform hook", async () => {
    const plugin = flowview({ compilerPath: "" });
    if (typeof plugin.configResolved === "function") {
      plugin.configResolved.call({} as never, { root: "/project" } as never);
    }
    const transform = plugin.transform;
    const handler =
      typeof transform === "function" ? transform : transform?.handler;
    if (typeof handler !== "function")
      throw new Error("missing transform hook");
    const result = await handler.call(
      {
        warn() {},
        error(error: unknown) {
          throw error;
        },
      } as never,
      "<p>{{ context.name }}</p>",
      "/project/src/page.flow",
    );
    expect(result).toMatchObject({
      map: { version: 3, sources: ["src/page.flow"] },
    });
  });

  // @spec SPEC-HTML-083
  it("falls back to the npm WASM compiler when no binary is resolved", async () => {
    const { code } = await compileFlowview("<p>Hello {{ context.name }}</p>", {
      filename: "greeting.flow",
      runtimeImport: "@flowview/runtime",
      compilerPath: "",
    });

    expect(code).toContain("output += 'Hello ';");
    expect(code).toContain("renderValue(context.name)");
  });

  // @spec SPEC-HTML-030
  it("preserves display filenames and line offsets in diagnostics", async () => {
    await expect(
      compileFlowview("@if () { <p>Invalid</p> }", {
        filename: "component.astro",
        lineOffset: 11,
        runtimeImport: "@flowview/runtime",
        compilerPath,
      }),
    ).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          filename: "component.astro",
          line: 12,
          message: "Expression cannot be empty",
        }),
      ]),
    });
  });

  // @spec SPEC-HTML-004 SPEC-HTML-008 SPEC-HTML-009 SPEC-HTML-010 SPEC-HTML-011 SPEC-HTML-012
  it("executes all current control-flow blocks with escaped values", async () => {
    const { code, warnings } = await compileFlowview(
      "@if (context.visible) {<p>{{ context.label }}</p>} @else {<p>hidden</p>}@for (item of context.items; track item.id) {<span>{{ item.name }}</span>} @empty {<span>empty</span>}@switch (context.status) {@case ('ready') {<strong>ready</strong>}@default {<strong>other</strong>}}",
      {
        filename: "control-flow.flow",
        runtimeImport: "@flowview/runtime",
        compilerPath,
      },
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.message).toContain("track");
    const render = evaluateGeneratedModule(code);

    expect(
      render({
        visible: true,
        label: "<flowview>",
        items: [{ id: 1, name: "First & safe" }],
        status: "ready",
      }),
    ).toBe(
      "<p>&lt;flowview&gt;</p><span>First &amp; safe</span><strong>ready</strong>",
    );

    expect(render({ visible: false, items: [], status: "unknown" })).toBe(
      "<p>hidden</p><span>empty</span><strong>other</strong>",
    );
  });

  // @spec SPEC-HTML-023
  it("compiles raw interpolation through the native compiler", async () => {
    const { code } = await compileFlowview(
      "<h1>{{ context.title }}</h1><article>{{{ context.bodyHtml }}}</article>",
      {
        filename: "raw.flow",
        runtimeImport: "@flowview/runtime",
        compilerPath,
      },
    );
    expect(code).toContain("renderRawValue(context.bodyHtml)");

    expect(
      evaluateGeneratedModule(code)({
        title: "<T>",
        bodyHtml: "<h2>Trusted</h2>",
      }),
    ).toBe("<h1>&lt;T&gt;</h1><article><h2>Trusted</h2></article>");
  });

  // @spec SPEC-HTML-023
  it("compiles raw interpolation through the bundled WASM compiler", async () => {
    const { code } = await compileFlowview("{{{ context.bodyHtml }}}", {
      filename: "raw.flow",
      runtimeImport: "@flowview/runtime",
      compilerPath: "",
    });

    expect(evaluateGeneratedModule(code)({ bodyHtml: "<b>x</b>" })).toBe(
      "<b>x</b>",
    );
  });

  // @spec SPEC-HTML-020
  it("reports raw interpolation inside attributes with a diagnostic", async () => {
    await expect(
      compileFlowview(`<div title="{{{ context.html }}}"></div>`, {
        filename: "component.astro",
        lineOffset: 4,
        runtimeImport: "@flowview/runtime",
        compilerPath,
      }),
    ).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "FV0022",
          filename: "component.astro",
          line: 5,
        }),
      ]),
    });
  });

  // @spec SPEC-HTML-080
  it("builds a real Vite consumer that imports a .flow file", async () => {
    const fixtureRoot = fileURLToPath(
      new URL("../test/fixtures/basic", import.meta.url),
    );
    const runtimeImport = fileURLToPath(
      new URL("../../runtime/src/index.ts", import.meta.url),
    );
    const result = await build({
      root: fixtureRoot,
      logLevel: "silent",
      plugins: [flowview({ compilerPath, runtimeImport })],
      build: {
        write: false,
        rollupOptions: {
          input: resolve(fixtureRoot, "main.ts"),
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(
      (entry) => ("output" in entry ? entry.output : []),
    );
    const bundle = outputs
      .filter((entry) => entry.type === "chunk")
      .map((entry) => entry.code)
      .join("\n");

    expect(bundle).toContain("flowview");
    expect(bundle).toContain("Hello");
    // The template was compiled at build time: no template syntax or compiler
    // is left in the output.
    expect(bundle).not.toContain("{{");
    expect(bundle).not.toMatch(/wasm|flowview-compiler|compileFlowview/i);
  });
});

describe("flowview Vite plugin hooks", () => {
  function transformHook(plugin: ReturnType<typeof flowview>) {
    const transform = plugin.transform;
    const handler =
      typeof transform === "function" ? transform : transform?.handler;
    if (typeof handler !== "function")
      throw new Error("missing transform hook");
    return handler;
  }

  // @spec SPEC-HTML-079
  it("leaves modules that are not .flow files untouched", async () => {
    const handler = transformHook(flowview({ compilerPath: "" }));
    const result = await handler.call(
      {} as never,
      "export const answer = 42;",
      "/project/src/main.ts",
    );
    expect(result).toBeNull();
  });

  // @spec SPEC-HTML-081
  it("surfaces diagnostics and warnings as located Vite errors and warnings", async () => {
    const handler = transformHook(flowview({ compilerPath: "" }));
    const warnings: string[] = [];
    const errors: Array<{
      message: string;
      id: string;
      loc: { line: number; column: number };
    }> = [];
    const context = {
      warn: (message: string) => warnings.push(message),
      error: (error: (typeof errors)[number]) => {
        errors.push(error);
        throw new Error(error.message);
      },
    };

    await handler.call(
      context as never,
      "@for (item of context.items; track item.id) {<p>{{ item }}</p>}",
      "/project/src/list.flow",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("/project/src/list.flow:1:");
    expect(warnings[0]).toContain("track");

    await expect(
      handler.call(
        context as never,
        "<p>ok</p>\n@if () {<p>bad</p>}",
        "/project/src/broken.flow",
      ),
    ).rejects.toThrow("Expression cannot be empty");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      id: "/project/src/broken.flow",
      loc: { line: 2 },
    });
    expect(errors[0]?.message).toContain("Expression cannot be empty");
  });

  // @spec SPEC-HTML-082
  it("uses the explicit compilerPath and reports when it is missing", async () => {
    expect(resolveCompilerPath("/custom/bin/flowview")).toBe(
      "/custom/bin/flowview",
    );
    await expect(
      compileFlowview("<p>x</p>", {
        filename: "x.flow",
        runtimeImport: "@flowview/runtime",
        compilerPath: "/definitely/not/a/flowview-binary",
      }),
    ).rejects.toThrow(/not found at "\/definitely\/not\/a\/flowview-binary"/);
  });

  // @spec SPEC-HTML-083
  it("prefers FLOWVIEW_COMPILER_PATH over workspace discovery but not compilerPath", () => {
    const previous = process.env.FLOWVIEW_COMPILER_PATH;
    process.env.FLOWVIEW_COMPILER_PATH = "/env/flowview";
    try {
      expect(resolveCompilerPath()).toBe("/env/flowview");
      expect(resolveCompilerPath("/explicit/flowview")).toBe(
        "/explicit/flowview",
      );
    } finally {
      if (previous === undefined) delete process.env.FLOWVIEW_COMPILER_PATH;
      else process.env.FLOWVIEW_COMPILER_PATH = previous;
    }
  });

  // @spec SPEC-HTML-084
  it("ships TypeScript declarations for .flow imports", () => {
    const declarations = readFileSync(
      fileURLToPath(new URL("../client.d.ts", import.meta.url)),
      "utf8",
    );
    expect(declarations).toContain('declare module "*.flow"');
    expect(declarations).toContain(
      "export function render(context: Record<string, unknown>): string;",
    );
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../package.json", import.meta.url)),
        "utf8",
      ),
    ) as { exports: Record<string, { types?: string }> };
    expect(manifest.exports["./client"]?.types).toBe("./client.d.ts");
  });

  // @spec SPEC-HTML-085
  it("invalidates the transformed module when a .flow file changes", () => {
    const plugin = flowview({ compilerPath: "" });
    const handleHotUpdate = plugin.handleHotUpdate as (ctx: {
      file: string;
      server: unknown;
    }) => void;
    const invalidated: unknown[] = [];
    const node = { id: "/project/src/page.flow" };
    const server = {
      moduleGraph: {
        getModuleById: (id: string) => (id === node.id ? node : undefined),
        invalidateModule: (module: unknown) => invalidated.push(module),
      },
    };

    handleHotUpdate({ file: "/project/src/page.flow", server });
    handleHotUpdate({ file: "/project/src/other.ts", server });

    expect(invalidated).toEqual([node]);
  });
});

function evaluateGeneratedModule(
  code: string,
): (context: Record<string, unknown>) => string {
  const executable = code
    .replace(/^import \{[^}]+\} from '[^']+';\n\n/, "")
    .replace("export function render", "function render");
  const renderValue = (value: unknown): string => {
    if (value === null || value === undefined || value === false) return "";
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character] ?? character,
    );
  };
  const renderAttributeValue = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    return renderValue(String(value));
  };
  const renderRawValue = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value === null || value === undefined || value === false) return "";
    throw new TypeError("unsupported raw value");
  };

  return Function(
    "renderAttributeValue",
    "renderRawValue",
    "renderValue",
    `"use strict";\n${executable}\nreturn render;`,
  )(renderAttributeValue, renderRawValue, renderValue) as (
    context: Record<string, unknown>,
  ) => string;
}

function originalAt(
  map: ConstructorParameters<typeof TraceMap>[0],
  code: string,
  expression: string,
) {
  const offset = code.indexOf(expression);
  const before = code.slice(0, offset);
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n") - 1;
  return originalPositionFor(new TraceMap(map), { line, column });
}
