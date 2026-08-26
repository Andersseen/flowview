import { describe, expect, it } from "vitest";
import {
  renderAttributeValue,
  renderValue,
} from "../../runtime/src/render-value";
import { compileFlowview, FlowviewCompilerError } from "./index";

function compiledRender<TContext>(
  source: string,
): (context: TContext) => string {
  const result = compileFlowview(source, {
    filename: "bindings.flow",
    runtimeImport: "@flowview/runtime",
  });
  const executable = result.code
    .replace(
      /^import \{ renderAttributeValue, renderValue \} from '[^']+';\n\n/,
      "",
    )
    .replace("export function render", "function render");

  return Function(
    "renderAttributeValue",
    "renderValue",
    `"use strict";\n${executable}\nreturn render;`,
  )(renderAttributeValue, renderValue) as (context: TContext) => string;
}

describe("compileFlowview", () => {
  it("compiles a template through WASM", () => {
    const result = compileFlowview("<p>Hello {{ context.name }}</p>", {
      filename: "hello.flow",
      runtimeImport: "@flowview/runtime",
    });

    expect(result.code).toContain("@flowview/runtime");
    expect(result.code).toContain("Hello ");
    expect(result.warnings).toEqual([]);
  });

  it("throws structured diagnostics", () => {
    expect(() =>
      compileFlowview("@if () { <p>Invalid</p> }", {
        filename: "broken.flow",
      }),
    ).toThrow(FlowviewCompilerError);
  });

  it("renders boolean bindings with HTML boolean attribute semantics", () => {
    const render = compiledRender<{ loading: boolean; canSubmit: boolean }>(
      `<button [disabled]="context.loading" [required]="!context.canSubmit">Save</button>`,
    );

    expect(render({ loading: true, canSubmit: false })).toBe(
      "<button disabled required>Save</button>",
    );
    expect(render({ loading: false, canSubmit: true })).toBe(
      "<button>Save</button>",
    );
  });

  it("renders attr bindings with nullable omission and escaped values", () => {
    const render = compiledRender<{
      busy: boolean;
      status: string | number | null | undefined;
      label: string;
    }>(
      `<article [attr.aria-busy]="context.busy" [attr.data-status]="context.status" [attr.data-label]="context.label"></article>`,
    );

    expect(render({ busy: false, status: 7, label: `" onmouseover="x` })).toBe(
      `<article aria-busy="false" data-status="7" data-label="&quot; onmouseover=&quot;x"></article>`,
    );
    expect(render({ busy: true, status: null, label: "ok" })).toBe(
      `<article aria-busy="true" data-label="ok"></article>`,
    );
    expect(render({ busy: true, status: undefined, label: "ok" })).toBe(
      `<article aria-busy="true" data-label="ok"></article>`,
    );
  });

  it("composes class bindings with static classes without duplicates", () => {
    const render = compiledRender<{ running: boolean; failed: boolean }>(
      `<article class="audit-card error" [class.loading]="context.running" [class.error]="context.failed"></article>`,
    );

    expect(render({ running: true, failed: false })).toBe(
      `<article class="audit-card error loading"></article>`,
    );
    expect(render({ running: false, failed: false })).toBe(
      `<article class="audit-card error"></article>`,
    );
    expect(render({ running: false, failed: true })).toBe(
      `<article class="audit-card error"></article>`,
    );
  });

  it("renders bindings inside control flow blocks", () => {
    const render = compiledRender<{
      show: boolean;
      items: { id: number; active: boolean }[];
    }>(
      `@if (context.show) { <button [hidden]="false">Open</button> } @for (item of context.items; track item.id) { <span [class.active]="item.active">{{ item.id }}</span> }`,
    );

    expect(render({ show: true, items: [{ id: 1, active: true }] })).toContain(
      `<button>Open</button>`,
    );
    expect(render({ show: true, items: [{ id: 1, active: true }] })).toContain(
      `<span class="active">1</span>`,
    );
  });

  it("keeps Flowview Events attributes when bindings are present", () => {
    const render = compiledRender<{ loading: boolean }>(
      `<button data-flow-on-click="retry" data-flow-scope="scope" [disabled]="context.loading" [class.loading]="context.loading">Retry</button>`,
    );

    expect(render({ loading: true })).toBe(
      `<button class="loading" data-flow-on-click="retry" data-flow-scope="scope" disabled>Retry</button>`,
    );
  });
});
