import { describe, expect, it } from "vitest";
import { hashScope } from "./scope.js";

describe("hashScope", () => {
  it("returns a 12-character lowercase hex id", () => {
    expect(hashScope("/src/pages/index.flow")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic for the same path and differs for different paths", () => {
    expect(hashScope("/src/pages/a.flow")).toBe(hashScope("/src/pages/a.flow"));
    expect(hashScope("/src/pages/a.flow")).not.toBe(
      hashScope("/src/pages/b.flow"),
    );
  });
});
