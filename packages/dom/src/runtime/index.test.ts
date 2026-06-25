import { describe, expect, it } from "vitest";
import { bindFlowEvents } from "./index";

function setDocument(html: string): void {
  document.body.innerHTML = html;
}

describe("bindFlowEvents", () => {
  it("calls a click handler with no args", () => {
    setDocument(`<button data-flow-on-click="save">Save</button>`);
    const calls: unknown[] = [];
    bindFlowEvents({
      save: () => {
        calls.push("saved");
      },
    });

    const button = document.querySelector("button") as HTMLButtonElement;
    button.click();
    expect(calls).toEqual(["saved"]);
  });

  it("calls a click handler with serialized args", () => {
    setDocument(
      `<button data-flow-on-click="removeItem" data-flow-args='["item-1"]'>Remove</button>`,
    );
    const calls: unknown[] = [];
    bindFlowEvents({
      removeItem: (id: string) => {
        calls.push(id);
      },
    });

    const button = document.querySelector("button") as HTMLButtonElement;
    button.click();
    expect(calls).toEqual(["item-1"]);
  });

  it("passes $event to the handler", () => {
    setDocument(
      `<button data-flow-on-click="save" data-flow-args='[{"__flow":"$event"}]'>Save</button>`,
    );
    const events: Event[] = [];
    bindFlowEvents({
      save: (event: Event) => {
        events.push(event);
      },
    });

    const button = document.querySelector("button") as HTMLButtonElement;
    button.click();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("click");
  });

  it("passes $el to the handler", () => {
    setDocument(
      `<button data-flow-on-click="focus" data-flow-args='[{"__flow":"$el"}]'>Focus</button>`,
    );
    const elements: Element[] = [];
    bindFlowEvents({
      focus: (element: Element) => {
        elements.push(element);
      },
    });

    const button = document.querySelector("button") as HTMLButtonElement;
    button.click();
    expect(elements).toEqual([button]);
  });

  it("warns when a handler is missing", () => {
    setDocument(`<button data-flow-on-click="missing">Click</button>`);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string) => warnings.push(message);

    bindFlowEvents({});

    const button = document.querySelector("button") as HTMLButtonElement;
    button.click();
    expect(warnings).toEqual([
      '[flowmark] Event handler "missing" is not a function.',
    ]);

    console.warn = originalWarn;
  });

  it("handles input events", () => {
    setDocument(
      `<input data-flow-on-input="search" data-flow-args='[{"__flow":"$event"}]' />`,
    );
    const values: string[] = [];
    bindFlowEvents({
      search: (event: Event) => {
        values.push((event.target as HTMLInputElement).value);
      },
    });

    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(values).toEqual(["hello"]);
  });
});
