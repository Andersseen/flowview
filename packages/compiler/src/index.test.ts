import { describe, expect, it } from "vitest";
import { compileFlowview, FlowviewCompilerError } from "./index";

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
});
