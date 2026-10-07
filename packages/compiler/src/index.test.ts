import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  renderAttributeValue,
  renderRawValue,
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
    .replace(/^import \{[^}]+\} from '[^']+';\n\n/, "")
    .replace("export function render", "function render");

  return Function(
    "renderAttributeValue",
    "renderRawValue",
    "renderValue",
    `"use strict";\n${executable}\nreturn render;`,
  )(renderAttributeValue, renderRawValue, renderValue) as (
    context: TContext,
  ) => string;
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

interface ParityFixtures {
  cases: Array<{
    name: string;
    template: string;
    context: Record<string, unknown>;
    expected: string;
  }>;
  rejects: Array<{
    name: string;
    template: string;
    context: Record<string, unknown>;
  }>;
}

// Shared with the Rust static renderer tests: both targets must agree.
const parity = JSON.parse(
  readFileSync(
    new URL(
      "../../../crates/flowview-compiler/tests/fixtures/raw-interpolation-parity.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as ParityFixtures;

describe("raw interpolation {{{ }}}", () => {
  it("keeps {{ }} escaped and {{{ }}} verbatim in one template", () => {
    const render = compiledRender<{ title: string; bodyHtml: string }>(
      `<main><h1>{{ context.title }}</h1><article>{{{ context.bodyHtml }}}</article></main>`,
    );

    expect(
      render({ title: "<Architecture>", bodyHtml: "<h2>Boundaries</h2>" }),
    ).toBe(
      "<main><h1>&lt;Architecture&gt;</h1><article><h2>Boundaries</h2></article></main>",
    );
  });

  it("security regression: escaped payloads stay inert, raw ones are verbatim", () => {
    const payload = "<script>alert(1)</script>";

    expect(
      compiledRender<{ payload: string }>("{{ context.payload }}")({ payload }),
    ).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(
      compiledRender<{ payload: string }>("{{{ context.payload }}}")({
        payload,
      }),
    ).toBe(payload);
  });

  it("works inside @if, @for and @switch", () => {
    const render = compiledRender<Record<string, unknown>>(
      `@if (context.html) {<s>{{{ context.html }}}</s>}` +
        `@for (s of context.sections) {<h2>{{ s.title }}</h2>{{{ s.html }}}}` +
        `@switch (context.kind) { @case ('a') {a} @case ('b') {<i>{{{ context.html }}}</i>} }`,
    );

    expect(
      render({
        html: "<em>x</em>",
        sections: [{ title: "<A>", html: "<p>1</p>" }],
        kind: "b",
      }),
    ).toBe("<s><em>x</em></s><h2>&lt;A&gt;</h2><p>1</p><i><em>x</em></i>");
  });

  it("imports renderRawValue only for templates that use it", () => {
    const options = { filename: "x.flow", runtimeImport: "@flowview/runtime" };

    expect(compileFlowview("{{{ context.a }}}", options).code).toContain(
      "import { renderAttributeValue, renderRawValue, renderValue } from '@flowview/runtime';",
    );
    expect(compileFlowview("{{ context.a }}", options).code).toContain(
      "import { renderAttributeValue, renderValue } from '@flowview/runtime';",
    );
  });

  it.each(parity.cases)("parity fixture: $name", (fixture) => {
    const render = compiledRender<Record<string, unknown>>(fixture.template);
    expect(render(fixture.context)).toBe(fixture.expected);
  });

  it.each(parity.rejects)(
    "parity fixture: rejects $name at render time",
    (fixture) => {
      const render = compiledRender<Record<string, unknown>>(fixture.template);
      expect(() => render(fixture.context)).toThrow(TypeError);
    },
  );

  it("rejects raw interpolation in attributes with a structured diagnostic", () => {
    try {
      compileFlowview(`<div title="{{{ context.html }}}"></div>`, {
        filename: "page.flow",
      });
      expect.unreachable("compilation should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FlowviewCompilerError);
      expect((error as FlowviewCompilerError).diagnostics[0]).toMatchObject({
        code: "FV0022",
        severity: "error",
        filename: "page.flow",
        line: 1,
        column: 13,
      });
    }
  });

  it("reports empty and unclosed raw interpolation", () => {
    const codeOf = (source: string): string | null | undefined => {
      try {
        compileFlowview(source);
      } catch (error) {
        return (error as FlowviewCompilerError).diagnostics[0]?.code;
      }
      return undefined;
    };

    expect(codeOf("{{{ }}}")).toBe("FV0023");
    expect(codeOf("{{{ context.a")).toBe("FV0024");
  });
});
