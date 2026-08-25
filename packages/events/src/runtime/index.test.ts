import { describe, expect, it } from "vitest";
import { registerFlowHandlers } from "./index.js";

function setDocument(html: string): void {
  document.body.innerHTML = html;
}

describe("registerFlowHandlers", () => {
  it("resolves the same handler name independently per scope", () => {
    setDocument(`
      <button data-flow-on-click="save" data-flow-scope="scope-a">A</button>
      <button data-flow-on-click="save" data-flow-scope="scope-b">B</button>
    `);
    const callsA: unknown[] = [];
    const callsB: unknown[] = [];

    registerFlowHandlers("scope-a", { save: () => callsA.push("a") }, [
      "click",
    ]);
    registerFlowHandlers("scope-b", { save: () => callsB.push("b") }, [
      "click",
    ]);

    const [buttonA, buttonB] = Array.from(document.querySelectorAll("button"));
    (buttonA as HTMLButtonElement).click();
    expect(callsA).toEqual(["a"]);
    expect(callsB).toEqual([]);

    (buttonB as HTMLButtonElement).click();
    expect(callsA).toEqual(["a"]);
    expect(callsB).toEqual(["b"]);
  });

  it("fires for elements added to the DOM after registration", () => {
    setDocument("");
    const calls: unknown[] = [];

    registerFlowHandlers("scope-late", { save: () => calls.push("saved") }, [
      "click",
    ]);

    const button = document.createElement("button");
    button.setAttribute("data-flow-on-click", "save");
    button.setAttribute("data-flow-scope", "scope-late");
    document.body.appendChild(button);

    button.click();
    expect(calls).toEqual(["saved"]);
  });

  it("resolves dynamic template-scope arguments from compiled data attributes", () => {
    setDocument(`
      <button
        data-flow-on-click="cancelAudit"
        data-flow-scope="scope-dynamic"
        data-flow-args='[{"__flow":"$scope","attr":"data-flow-arg-0"},{"__flow":"$scope","attr":"data-flow-arg-1"}]'
        data-flow-arg-0='"audit-1"'
        data-flow-arg-1='42'
      >Stop</button>
    `);
    const calls: unknown[][] = [];

    registerFlowHandlers(
      "scope-dynamic",
      { cancelAudit: (...args) => calls.push(args) },
      ["click"],
    );

    const button = document.querySelector("button") as HTMLButtonElement;
    button.click();

    expect(calls).toEqual([["audit-1", 42]]);
  });

  it("delegates non-bubbling focus events via the capture phase", () => {
    setDocument(
      `<input data-flow-on-focus="onFocus" data-flow-scope="scope-focus" />`,
    );
    const calls: unknown[] = [];

    registerFlowHandlers(
      "scope-focus",
      { onFocus: () => calls.push("focused") },
      ["focus"],
    );

    const input = document.querySelector("input") as HTMLInputElement;
    input.focus();
    expect(calls).toEqual(["focused"]);
  });

  it("unbind removes only its own scope", () => {
    setDocument(`
      <button data-flow-on-click="save" data-flow-scope="scope-x">X</button>
      <button data-flow-on-click="save" data-flow-scope="scope-y">Y</button>
    `);
    const callsX: unknown[] = [];
    const callsY: unknown[] = [];

    const unbindX = registerFlowHandlers(
      "scope-x",
      { save: () => callsX.push("x") },
      ["click"],
    );
    registerFlowHandlers("scope-y", { save: () => callsY.push("y") }, [
      "click",
    ]);

    unbindX();

    const [buttonX, buttonY] = Array.from(document.querySelectorAll("button"));
    (buttonX as HTMLButtonElement).click();
    (buttonY as HTMLButtonElement).click();

    expect(callsX).toEqual([]);
    expect(callsY).toEqual(["y"]);
  });
});
