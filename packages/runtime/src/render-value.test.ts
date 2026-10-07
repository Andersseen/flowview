import { describe, expect, it } from "vitest";
import {
  renderAttributeValue,
  renderRawValue,
  renderValue,
} from "./render-value";

describe("renderValue", () => {
  it("escapes HTML by default", () => {
    expect(renderValue("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("renders null as empty string", () => {
    expect(renderValue(null)).toBe("");
  });

  it("renders undefined as empty string", () => {
    expect(renderValue(undefined)).toBe("");
  });

  it("renders false as empty string", () => {
    expect(renderValue(false)).toBe("");
  });

  it("renders true as the string 'true'", () => {
    expect(renderValue(true)).toBe("true");
  });

  it("renders zero as the string '0'", () => {
    expect(renderValue(0)).toBe("0");
  });

  it("renders an empty string as an empty string", () => {
    expect(renderValue("")).toBe("");
  });

  it("renders primitive values", () => {
    expect(renderValue(123)).toBe("123");
  });

  it("coerces arrays via String()", () => {
    expect(renderValue([1, 2, 3])).toBe("1,2,3");
  });

  it("coerces objects via String()", () => {
    expect(renderValue({ key: "value" })).toBe("[object Object]");
  });
});

describe("renderAttributeValue", () => {
  it("omits only null and undefined", () => {
    expect(renderAttributeValue(null)).toBe("");
    expect(renderAttributeValue(undefined)).toBe("");
  });

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
  it("returns strings unchanged, without escaping", () => {
    const html = `<h2 class="x">Fish & 'chips'</h2><script>alert(1)</script>`;
    expect(renderRawValue(html)).toBe(html);
  });

  it("returns an empty string unchanged", () => {
    expect(renderRawValue("")).toBe("");
  });

  it("renders null, undefined and false as an empty string", () => {
    expect(renderRawValue(null)).toBe("");
    expect(renderRawValue(undefined)).toBe("");
    expect(renderRawValue(false)).toBe("");
  });

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

  it("explains the contract in its error message", () => {
    expect(() => renderRawValue(42)).toThrow(
      /string, null, undefined or false/,
    );
  });

  it("does not change escaped rendering", () => {
    expect(renderValue("<b>")).toBe("&lt;b&gt;");
    expect(renderAttributeValue("<b>")).toBe("&lt;b&gt;");
  });
});
