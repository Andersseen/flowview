import { renderAttributeValue, renderValue } from "@flowview/runtime";
import { describe, expect, it, vi } from "vitest";
import { compileFlowview } from "../../compiler/src/index";
import { registerFlowHandlers } from "../../events/src/runtime/index";
import { createView, type RenderFunction } from "./index";

interface Item {
  id: number;
  name: string;
  status?: "completed" | "active";
}

interface ItemsContext {
  items: Item[];
}

function compiledRender<TContext>(source: string): RenderFunction<TContext> {
  const result = compileFlowview(source, {
    filename: "dom-test.flow",
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
  )(renderAttributeValue, renderValue) as RenderFunction<TContext>;
}

function setDocument(html: string): void {
  document.body.innerHTML = html;
}

describe("createView", () => {
  it("renders initial context", () => {
    setDocument(`<div id="target"></div>`);
    const view = createView("#target", (context: { name: string }) => {
      return `<p>${context.name}</p>`;
    });

    view.render({ name: "Ada" });

    expect(document.querySelector("#target")?.innerHTML).toBe("<p>Ada</p>");
  });

  it("updates with new context", () => {
    setDocument(`<div id="target"></div>`);
    const view = createView("#target", (context: { count: number }) => {
      return `<output>${context.count}</output>`;
    });

    view.render({ count: 1 });
    view.update({ count: 2 });

    expect(document.querySelector("output")?.textContent).toBe("2");
  });

  it("handles @for output from a compiled Flowview template", () => {
    setDocument(`<div id="target"></div>`);
    const render = compiledRender<ItemsContext>(`
      <ul>
        @for (item of context.items; track item.id) {
          <li>{{ item.name }}</li>
        }
      </ul>
    `);
    const view = createView("#target", render);

    view.render({ items: [{ id: 1, name: "Alpha" }] });

    expect(document.querySelector("#target")?.textContent).toContain("Alpha");
  });

  it("handles @empty", () => {
    setDocument(`<div id="target"></div>`);
    const render = compiledRender<ItemsContext>(`
      @for (item of context.items; track item.id) {
        <p>{{ item.name }}</p>
      } @empty {
        <p>No items yet.</p>
      }
    `);
    const view = createView("#target", render);

    view.render({ items: [] });

    expect(document.querySelector("#target")?.textContent?.trim()).toBe(
      "No items yet.",
    );
  });

  it("handles @if", () => {
    setDocument(`<div id="target"></div>`);
    const render = compiledRender<ItemsContext>(`
      @for (item of context.items; track item.id) {
        @if (item.status === "completed") {
          <span>Completed</span>
        }
      }
    `);
    const view = createView("#target", render);

    view.render({ items: [{ id: 1, name: "Alpha", status: "completed" }] });

    expect(document.querySelector("#target")?.textContent?.trim()).toBe(
      "Completed",
    );
  });

  it("keeps interpolated values escaped", () => {
    setDocument(`<div id="target"></div>`);
    const render = compiledRender<ItemsContext>(`
      @for (item of context.items; track item.id) {
        <p>{{ item.name }}</p>
      }
    `);
    const view = createView("#target", render);

    view.render({
      items: [{ id: 1, name: `<script>alert("x")</script>` }],
    });

    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("p")?.textContent).toBe(
      `<script>alert("x")</script>`,
    );
  });

  it("throws a useful error for a missing selector target", () => {
    setDocument(`<div></div>`);

    expect(() => createView("#missing", () => "")).toThrow(
      `[flowview] Could not find DOM target for selector "#missing".`,
    );
  });

  it("accepts an Element directly", () => {
    setDocument(`<main><section></section></main>`);
    const element = document.querySelector("section");
    if (element === null) throw new Error("missing section");
    const view = createView(element, () => "<p>Direct</p>");

    view.render({});

    expect(element.innerHTML).toBe("<p>Direct</p>");
  });

  it("accepts a selector", () => {
    setDocument(`<div id="target"></div>`);
    const view = createView("#target", () => "<p>Selector</p>");

    view.render({});

    expect(document.querySelector("#target")?.innerHTML).toBe(
      "<p>Selector</p>",
    );
  });

  it("allows multiple independent views to coexist", () => {
    setDocument(`<div id="one"></div><div id="two"></div>`);
    const one = createView("#one", (context: { label: string }) => {
      return `<p>${context.label}</p>`;
    });
    const two = createView("#two", (context: { label: string }) => {
      return `<p>${context.label}</p>`;
    });

    one.render({ label: "One" });
    two.render({ label: "Two" });

    expect(document.querySelector("#one")?.textContent).toBe("One");
    expect(document.querySelector("#two")?.textContent).toBe("Two");
  });

  it("updates without recreating the view", () => {
    setDocument(`<div id="target"></div>`);
    const render = vi.fn((context: { label: string }) => {
      return `<p>${context.label}</p>`;
    });
    const view = createView("#target", render);

    view.render({ label: "Initial" });
    view.update({ label: "Updated" });

    expect(render).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#target")?.textContent).toBe("Updated");
  });

  it("keeps Flowview Events working after update", () => {
    setDocument(`<div id="target"></div><output id="selected">none</output>`);
    const render: RenderFunction<ItemsContext> = (context) =>
      context.items
        .map(
          (item) =>
            `<button data-flow-on-click="selectItem" data-flow-scope="dom-events" data-flow-args='[{"__flow":"$scope","attr":"data-flow-arg-0"}]' data-flow-arg-0="${renderValue(item.id)}">Select ${renderValue(item.name)}</button>`,
        )
        .join("");
    const calls: number[] = [];
    registerFlowHandlers(
      "dom-events",
      {
        selectItem(id: number) {
          calls.push(id);
          const output = document.querySelector("#selected");
          if (output) output.textContent = String(id);
        },
      },
      ["click"],
    );
    const view = createView("#target", render);

    view.render({ items: [{ id: 1, name: "One" }] });
    view.update({ items: [{ id: 2, name: "Two" }] });
    (document.querySelector("button") as HTMLButtonElement).click();

    expect(calls).toEqual([2]);
    expect(document.querySelector("#selected")?.textContent).toBe("2");
  });

  it("updates compiled declarative bindings through rerendered HTML", () => {
    setDocument(`<div id="target"></div>`);
    const render = compiledRender<{ loading: boolean; status: string }>(`
      <button [disabled]="context.loading">Run</button>
      <section
        [attr.aria-busy]="context.loading"
        [class.loading]="context.status === 'running'"
      >
        {{ context.status }}
      </section>
    `);
    const view = createView("#target", render);

    view.render({ loading: false, status: "idle" });
    expect(
      (document.querySelector("button") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(document.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(
      document.querySelector("section")?.classList.contains("loading"),
    ).toBe(false);

    view.update({ loading: true, status: "running" });

    expect(
      (document.querySelector("button") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(document.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(
      document.querySelector("section")?.classList.contains("loading"),
    ).toBe(true);
  });
});
