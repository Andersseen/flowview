import { describe, expect, it } from "vitest";
import { renderValue } from "./render-value";

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
