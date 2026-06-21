import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFlowmark } from "./index";

const compilerPath = fileURLToPath(
  new URL("../../../target/debug/flowmark", import.meta.url),
);

describe("compileFlowmark", () => {
  it("compiles stdin without temporary files", () => {
    const code = compileFlowmark("<p>Hello {{ ctx.name }}</p>", {
      filename: "greeting.flow",
      runtimeImport: "@flowmark/runtime",
      compilerPath,
    });

    expect(code).toContain("output += '<p>Hello ';");
    expect(code).toContain("renderValue(ctx.name)");
  });

  it("preserves display filenames and line offsets in diagnostics", () => {
    expect(() =>
      compileFlowmark("@if () { <p>Invalid</p> }", {
        filename: "component.astro",
        lineOffset: 11,
        runtimeImport: "@flowmark/runtime",
        compilerPath,
      }),
    ).toThrow(/component\.astro:12:\d+: error: Expression cannot be empty/);
  });

  it("executes all current control-flow blocks with escaped values", () => {
    const code = compileFlowmark(
      "@if (ctx.visible) {<p>{{ ctx.label }}</p>} @else {<p>hidden</p>}@for (item of ctx.items; track item.id) {<span>{{ item.name }}</span>} @empty {<span>empty</span>}@switch (ctx.status) {@case ('ready') {<strong>ready</strong>}@default {<strong>other</strong>}}",
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
