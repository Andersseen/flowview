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
  it("discovers the workspace compiler without configuration", () => {
    expect(resolveCompilerPath()).toBe(compilerPath);
  });

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

  it("falls back to the npm WASM compiler when no binary is resolved", async () => {
    const { code } = await compileFlowview("<p>Hello {{ context.name }}</p>", {
      filename: "greeting.flow",
      runtimeImport: "@flowview/runtime",
      compilerPath: "",
    });

    expect(code).toContain("output += 'Hello ';");
    expect(code).toContain("renderValue(context.name)");
  });

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
