import { describe, expect, it } from "vitest";
import * as runtime from "./index";
import type { RenderContext, RenderFunction } from "./index";

describe("runtime exports", () => {
  // @spec SPEC-HTML-038
  it("exports the render helpers and the render types", () => {
    expect(Object.keys(runtime).sort()).toEqual([
      "escapeHtml",
      "renderAttributeValue",
      "renderRawValue",
      "renderValue",
    ]);
    for (const helper of Object.values(runtime)) {
      expect(typeof helper).toBe("function");
    }

    // Compile-time check that the documented types exist and compose.
    const render: RenderFunction<RenderContext> = (context) =>
      String(context.name);
    expect(render({ name: "ok" })).toBe("ok");
  });
});
