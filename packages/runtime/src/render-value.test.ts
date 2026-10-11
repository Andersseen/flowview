import { describe, expect, it } from "vitest";
import {
  renderAttributeValue,
  renderRawValue,
  renderValue,
} from "./render-value";

describe("renderValue", () => {
  // @spec SPEC-HTML-040
  it("escapes HTML by default", () => {
    expect(renderValue("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  // @spec SPEC-HTML-039
  it("renders null as empty string", () => {
    expect(renderValue(null)).toBe("");
  });

  // @spec SPEC-HTML-039
  it("renders undefined as empty string", () => {
    expect(renderValue(undefined)).toBe("");
  });

  // @spec SPEC-HTML-039
  it("renders false as empty string", () => {
    expect(renderValue(false)).toBe("");
  });

  // @spec SPEC-HTML-039
  it("renders true as the string 'true'", () => {
    expect(renderValue(true)).toBe("true");
  });

  // @spec SPEC-HTML-039
  it("renders zero as the string '0'", () => {
    expect(renderValue(0)).toBe("0");
  });

  // @spec SPEC-HTML-039
  it("renders an empty string as an empty string", () => {
    expect(renderValue("")).toBe("");
  });

  // @spec SPEC-HTML-039
  it("renders primitive values", () => {
    expect(renderValue(123)).toBe("123");
  });

  // @spec SPEC-HTML-039
  it("coerces arrays via String()", () => {
    expect(renderValue([1, 2, 3])).toBe("1,2,3");
  });

  // @spec SPEC-HTML-039
  it("coerces objects via String()", () => {
    expect(renderValue({ key: "value" })).toBe("[object Object]");
  });
});

describe("renderAttributeValue", () => {
  // @spec SPEC-HTML-041
  it("omits only null and undefined", () => {
    expect(renderAttributeValue(null)).toBe("");
    expect(renderAttributeValue(undefined)).toBe("");
  });

  // @spec SPEC-HTML-041
  it("preserves false and true as strings", () => {
    expect(renderAttributeValue(false)).toBe("false");
    expect(renderAttributeValue(true)).toBe("true");
  });

  it("escapes HTML-sensitive characters", () => {
    expect(renderAttributeValue(`" onmouseover="alert(1)`)).toBe(
      "&quot; onmouseover=&quot;alert(1)",
    );
  });
});

describe("renderRawValue", () => {
  // @spec SPEC-HTML-023
  it("returns strings unchanged, without escaping", () => {
    const html = `<h2 class="x">Fish & 'chips'</h2><script>alert(1)</script>`;
    expect(renderRawValue(html)).toBe(html);
  });

  // @spec SPEC-HTML-023
  it("returns an empty string unchanged", () => {
    expect(renderRawValue("")).toBe("");
  });

  // @spec SPEC-HTML-024
  it("renders null, undefined and false as an empty string", () => {
    expect(renderRawValue(null)).toBe("");
    expect(renderRawValue(undefined)).toBe("");
    expect(renderRawValue(false)).toBe("");
  });

  // @spec SPEC-HTML-025
  it("rejects every other type instead of guessing", () => {
    const rejected: Array<[unknown, string]> = [
      [42, "number"],
      [0, "number"],
      [Number.NaN, "number"],
      [true, "boolean"],
      [1n, "bigint"],
      [[], "array"],
      [["<b>x</b>"], "array"],
      [{}, "object"],
      [{ html: "<b>x</b>" }, "object"],
      [{ toString: () => "<b>x</b>" }, "object"],
      [Symbol("x"), "symbol"],
      [() => "<b>x</b>", "function"],
    ];

    for (const [value, kind] of rejected) {
      expect(() => renderRawValue(value), kind).toThrow(TypeError);
      expect(() => renderRawValue(value), kind).toThrow(
        new RegExp(`of type ${kind}\\b`),
      );
    }
  });

  // @spec SPEC-HTML-025
  it("explains the contract in its error message", () => {
    expect(() => renderRawValue(42)).toThrow(
      /string, null, undefined or false/,
    );
  });

  // @spec SPEC-HTML-029
  it("does not change escaped rendering", () => {
    expect(renderValue("<b>")).toBe("&lt;b&gt;");
    expect(renderAttributeValue("<b>")).toBe("&lt;b&gt;");
  });
});
