import { renderAttributeValue, renderValue } from "@flowview/runtime";
import { computed, signal } from "../../reactive/src/index";
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

  // @spec SPEC-HTML-117
  it("preserves data-flow-ref as an ordinary attribute in JavaScript output", () => {
    setDocument(`<div id="target"></div>`);
    const render = compiledRender<Record<string, never>>(
      `<p data-flow-ref="summary">Text</p>`,
    );
    const view = createView("#target", render);

    view.render({});

    expect(view.ref("summary")?.outerHTML).toBe(
      `<p data-flow-ref="summary">Text</p>`,
    );
  });

  // @spec SPEC-HTML-106
  it("resolves refs only within this view and reads the current conditional and loop output", () => {
    setDocument(`<div id="one"></div><div id="two"></div>`);
    const render = compiledRender<{
      visible: boolean;
      items: string[];
    }>(`
      @if (context.visible) {
        <input data-flow-ref="search" />
      }
      @for (item of context.items) {
        <li data-flow-ref="item">{{ item }}</li>
      }
    `);
    const one = createView("#one", render);
    const two = createView("#two", render);

    one.render({ visible: true, items: ["Alpha", "Beta"] });
    two.render({ visible: true, items: ["Other"] });

    expect(one.ref<HTMLInputElement>("search")).toBeInstanceOf(
      HTMLInputElement,
    );
    expect(one.refs("item").map((item) => item.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(two.refs("item")).toHaveLength(1);
    one.update({ visible: false, items: ["Gamma"] });
    expect(one.ref("search")).toBeNull();
    expect(one.refs("item").map((item) => item.textContent)).toEqual(["Gamma"]);
  });

  // @spec SPEC-HTML-107
  it("returns null for absent refs and rejects ambiguous singular refs with an actionable error", () => {
    setDocument(`<div id="target"></div>`);
    const view = createView(
      "#target",
      () =>
        `<p data-flow-ref="item">One</p><p data-flow-ref="item">Two</p><i data-flow-ref='"[x]🙂'></i>`,
    );
    view.render({});

    expect(view.ref("missing")).toBeNull();
    expect(() => view.ref("item")).toThrow(
      'Reference "item" matched 2 elements in this view. Use view.refs("item") to read all matches.',
    );
    expect(view.ref('"[x]🙂')?.tagName).toBe("I");
  });

  // @spec SPEC-HTML-108
  it("returns current Element snapshots that become detached after replacement", () => {
    setDocument(`<div id="target"></div>`);
    const view = createView<{ label: string }>(
      "#target",
      ({ label }) => `<p data-flow-ref="label">${label}</p>`,
    );
    view.render({ label: "before" });
    const previous = view.ref("label");

    view.update({ label: "after" });

    expect(previous?.isConnected).toBe(false);
    expect(view.ref("label")?.textContent).toBe("after");
  });

  // @spec SPEC-HTML-109
  it("keeps sibling refs isolated and lets an outer view see a nested root but not its contents", () => {
    setDocument(`<div id="one"></div><div id="two"></div>`);
    const one = createView(
      "#one",
      () =>
        `<p data-flow-ref="outer">Outer</p><section id="inner" data-flow-ref="inner-root"><i data-flow-ref="inner">Inner</i></section>`,
    );
    const two = createView("#two", () => `<b data-flow-ref="outer">Other</b>`);
    one.render({});
    two.render({});
    const inner = createView(
      "#inner",
      () => `<i data-flow-ref="child">Child</i>`,
    );
    inner.render({});

    expect(one.ref("outer")?.textContent).toBe("Outer");
    expect(one.ref("inner-root")?.tagName).toBe("SECTION");
    expect(one.ref("inner")).toBeNull();
    expect(inner.ref("child")?.textContent).toBe("Child");
    expect(two.ref("outer")?.textContent).toBe("Other");
  });

  // @spec SPEC-HTML-110
  it("rejects duplicate root ownership and releases ownership on idempotent dispose without clearing DOM", () => {
    setDocument(`<div id="target"></div>`);
    const target = document.querySelector("#target") as Element;
    const first = createView(target, () => `<p>Kept</p>`);
    expect(() => createView(target, () => "")).toThrow(
      "This DOM root is already owned by an active view.",
    );
    first.render({});
    first.dispose();
    first.dispose();

    expect(target.textContent).toBe("Kept");
    expect(() => first.update({})).toThrow("disposed view");
    const replacement = createView(target, () => `<b>New owner</b>`);
    replacement.render({});
    expect(target.textContent).toBe("New owner");
  });

  // @spec SPEC-HTML-111
  it("binds structurally to Signal and Computed and renders their current value synchronously", () => {
    setDocument(`<div id="target"></div>`);
    const count = signal(1);
    const doubled = computed(() => count() * 2);
    const view = createView(
      "#target",
      (value: number) => `<output>${value}</output>`,
    );

    const stop = view.bind(doubled);
    expect(document.querySelector("output")?.textContent).toBe("2");
    count.set(2);
    expect(document.querySelector("output")?.textContent).toBe("4");
    stop();
    stop();
    count.set(3);
    expect(document.querySelector("output")?.textContent).toBe("4");
    view.update(7);
    expect(document.querySelector("output")?.textContent).toBe("7");
    view.bind(count)();
    expect(document.querySelector("output")?.textContent).toBe("3");
  });

  // @spec SPEC-HTML-112
  it("allows one binding at a time and propagates failed initial renders without corrupting the view", () => {
    setDocument(`<div id="target"></div>`);
    const source = signal(1);
    const view = createView("#target", (value: number) => {
      if (value === 2) throw new Error("render failed");
      return `<output>${value}</output>`;
    });
    const stop = view.bind(source);
    expect(() => view.bind(source)).toThrow("already has an active binding");
    stop();
    const rejectedSource = signal(2);
    expect(() => view.bind(rejectedSource)).toThrow("render failed");
    expect(document.querySelector("output")?.textContent).toBe("1");
    view.update(3);
    rejectedSource.set(4);
    expect(document.querySelector("output")?.textContent).toBe("3");
    source.set(4);
    expect(document.querySelector("output")?.textContent).toBe("3");

    const liveSource = signal(3);
    const stopLive = view.bind(liveSource);
    expect(() => liveSource.set(2)).toThrow("render failed");
    expect(document.querySelector("output")?.textContent).toBe("3");
    liveSource.set(5);
    expect(document.querySelector("output")?.textContent).toBe("5");
    stopLive();
  });

  // @spec SPEC-HTML-113
  it("disposes idempotently, stops a binding, and rejects all later view operations", () => {
    setDocument(`<div id="target"></div>`);
    const source = signal("before");
    const view = createView("#target", (value: string) => `<p>${value}</p>`);
    view.bind(source);
    const html = (document.querySelector("#target") as Element).innerHTML;

    view.dispose();
    view.dispose();
    source.set("after");

    expect((document.querySelector("#target") as Element).innerHTML).toBe(html);
    expect(() => view.render("x")).toThrow("disposed view");
    expect(() => view.update("x")).toThrow("disposed view");
    expect(() => view.ref("x")).toThrow("disposed view");
    expect(() => view.refs("x")).toThrow("disposed view");
    expect(() => view.bind(source)).toThrow("disposed view");
  });

  // @spec SPEC-HTML-114
  it("disposes nested views and their bindings before replacing the parent subtree", () => {
    setDocument(`<div id="outer"></div>`);
    const outer = createView("#outer", () => `<section id="inner"></section>`);
    outer.render({});
    const childState = signal("first");
    const inner = createView("#inner", (value: string) => `<p>${value}</p>`);
    inner.bind(childState);
    const detachedInner = document.querySelector("#inner") as Element;

    outer.update({});
    childState.set("detached update");

    expect(detachedInner.textContent).toBe("first");
    expect(() => inner.ref("anything")).toThrow("disposed view");
  });

  // @spec SPEC-HTML-115
  it("keeps delegated Flowview Events working after a bound replacement", () => {
    setDocument(`<div id="target"></div><output id="selected">none</output>`);
    const items = signal([{ id: 1, name: "One" }]);
    const calls: number[] = [];
    registerFlowHandlers(
      "bound-events",
      {
        selectItem(id: number) {
          calls.push(id);
          const output = document.querySelector("#selected");
          if (output) output.textContent = String(id);
        },
      },
      ["click"],
    );
    const view = createView(
      "#target",
      (context: { id: number; name: string }[]) =>
        context
          .map(
            (item) =>
              `<button data-flow-on-click="selectItem" data-flow-scope="bound-events" data-flow-args='[{"__flow":"$scope","attr":"data-flow-arg-0"}]' data-flow-arg-0="${renderValue(item.id)}">${renderValue(item.name)}</button>`,
          )
          .join(""),
    );
    view.bind(items);
    (document.querySelector("button") as HTMLButtonElement).click();
    items.set([{ id: 2, name: "Two" }]);
    (document.querySelector("button") as HTMLButtonElement).click();

    expect(calls).toEqual([1, 2]);
    expect(document.querySelector("#selected")?.textContent).toBe("2");
  });

  // @spec SPEC-HTML-116
  it("binds a structural value source without importing the Reactive package", () => {
    setDocument(`<div id="target"></div>`);
    let emit: ((value: string) => void) | undefined;
    const source = {
      subscribe(callback: (value: string) => void) {
        emit = callback;
        callback("first");
        return () => {
          emit = undefined;
        };
      },
    };
    const view = createView("#target", (value: string) => `<p>${value}</p>`);

    view.bind(source);
    emit?.("second");

    expect(document.querySelector("p")?.textContent).toBe("second");
  });
});
