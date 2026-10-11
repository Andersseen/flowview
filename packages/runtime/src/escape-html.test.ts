import { describe, expect, it } from "vitest";
import { escapeHtml } from "./escape-html";

describe("escapeHtml", () => {
  // @spec SPEC-HTML-039
  it("renders null as empty string", () => {
    expect(escapeHtml(null)).toBe("");
  });

  it("renders undefined as empty string", () => {
    expect(escapeHtml(undefined)).toBe("");
  });

  it("renders false as empty string", () => {
    expect(escapeHtml(false)).toBe("");
  });

  // @spec SPEC-HTML-040
  it("renders strings safely", () => {
    expect(escapeHtml("hello")).toBe("hello");
  });

  // @spec SPEC-HTML-040
  it("escapes HTML-sensitive characters", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
    );
  });

  // @spec SPEC-HTML-040
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("renders numbers safely", () => {
    expect(escapeHtml(42)).toBe("42");
  });

  it("renders bigint safely", () => {
    expect(escapeHtml(BigInt(42))).toBe("42");
  });
});
