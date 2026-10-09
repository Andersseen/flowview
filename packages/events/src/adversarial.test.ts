import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileScriptEvents, FlowviewEventsError } from "./index.js";
import { findEventBindings, parseHandlerExpression } from "./parser.js";

const htmlish = fc
  .array(
    fc.oneof(
      fc.constantFrom(
        "<",
        ">",
        "/",
        "<!--",
        "-->",
        "<script",
        "<style",
        "(click)",
        "(input)",
        '="',
        "='",
        "=`",
        "\\",
        "(",
        ")",
        "[",
        "]",
        "{",
        "}",
        "🌱",
        "@if",
        "{{ value }}",
      ),
      fc.string({ maxLength: 12 }),
    ),
    { maxLength: 64 },
  )
  .map((parts) => parts.join(""));

function isExpectedValidationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof TypeError) &&
    !(error instanceof RangeError)
  );
}

describe("adversarial Events inputs", () => {
  it("scans bounded arbitrary HTML-ish strings without throwing", () => {
    fc.assert(
      fc.property(htmlish, (input) => {
        expect(Array.isArray(findEventBindings(input))).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("returns a handler call or the documented validation Error", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 256 }), (input) => {
        try {
          const result = parseHandlerExpression(input);
          expect(typeof result.name).toBe("string");
          expect(Array.isArray(result.args)).toBe(true);
        } catch (error) {
          expect(isExpectedValidationError(error)).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("compiles arbitrary bounded template and script inputs to a result or Events diagnostic", () => {
    fc.assert(
      fc.property(
        htmlish,
        fc.string({ maxLength: 256 }),
        (template, scriptSource) => {
          try {
            compileScriptEvents({
              filename: "property.astro",
              scope: "property-scope",
              template,
              scriptOffset: 0,
              scriptSource,
            });
          } catch (error) {
            expect(error).toBeInstanceOf(FlowviewEventsError);
          }
        },
      ),
      { numRuns: 350 },
    );
  });
});
