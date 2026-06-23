import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "vite";
import flowmark, { compileFlowmark, resolveCompilerPath } from "./index";

const compilerPath = fileURLToPath(
  new URL("../../../target/debug/flowmark", import.meta.url),
);

describe("compileFlowmark", () => {
  it("discovers the workspace compiler without configuration", () => {
    expect(resolveCompilerPath()).toBe(compilerPath);
  });

  it("compiles stdin without temporary files", async () => {
    const code = await compileFlowmark("<p>Hello {{ context.name }}</p>", {
      filename: "greeting.flow",
      runtimeImport: "@flowmark/runtime",
      compilerPath,
    });

    expect(code).toContain("output += '<p>Hello ';");
    expect(code).toContain("renderValue(context.name)");
  });

  it("preserves display filenames and line offsets in diagnostics", async () => {
    await expect(
      compileFlowmark("@if () { <p>Invalid</p> }", {
        filename: "component.astro",
        lineOffset: 11,
        runtimeImport: "@flowmark/runtime",
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
    const code = await compileFlowmark(
      "@if (context.visible) {<p>{{ context.label }}</p>} @else {<p>hidden</p>}@for (item of context.items; track item.id) {<span>{{ item.name }}</span>} @empty {<span>empty</span>}@switch (context.status) {@case ('ready') {<strong>ready</strong>}@default {<strong>other</strong>}}",
      {
        filename: "control-flow.flow",
        runtimeImport: "@flowmark/runtime",
        compilerPath,
      },
    );
    const render = evaluateGeneratedModule(code);

    expect(
      render({
        visible: true,
        label: "<Flowmark>",
        items: [{ id: 1, name: "First & safe" }],
        status: "ready",
      }),
    ).toBe(
      "<p>&lt;Flowmark&gt;</p><span>First &amp; safe</span><strong>ready</strong>",
    );

    expect(render({ visible: false, items: [], status: "unknown" })).toBe(
      "<p>hidden</p><span>empty</span><strong>other</strong>",
    );
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
      plugins: [flowmark({ compilerPath, runtimeImport })],
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

    expect(bundle).toContain("Flowmark");
    expect(bundle).toContain("Hello");
  });
});

function evaluateGeneratedModule(
  code: string,
): (context: Record<string, unknown>) => string {
  const executable = code
    .replace(/^import \{ renderValue \} from '[^']+';\n\n/, "")
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

  return Function(
    "renderValue",
    `"use strict";\n${executable}\nreturn render;`,
  )(renderValue) as (context: Record<string, unknown>) => string;
}
