import { describe, expect, it } from "vitest";
import {
  findScriptFlowviewBlocks,
  FlowviewViteEventsParseError,
} from "./parser.js";

describe("findScriptFlowviewBlocks", () => {
  it("finds a single script data-flowview block with correct spans", () => {
    const source = `<button (click)="save()">Save</button>\n\n<script data-flowview>\nfunction save() {}\n</script>\n`;

    const [block] = findScriptFlowviewBlocks(source);

    expect(block).toBeDefined();
    expect(source.slice(block!.elementStart, block!.elementEnd)).toBe(
      "<script data-flowview>\nfunction save() {}\n</script>",
    );
    expect(block!.scriptSource).toBe("\nfunction save() {}\n");
    expect(
      source.slice(block!.scriptContentStart, block!.scriptContentEnd),
    ).toBe(block!.scriptSource);
  });

  it("removes the attribute and its leading space when stripped", () => {
    const source = `<script data-flowview>\nfunction save() {}\n</script>`;
    const [block] = findScriptFlowviewBlocks(source);

    const stripped =
      source.slice(0, block!.flowviewAttributeStart) +
      source.slice(block!.flowviewAttributeEnd);

    expect(stripped).toBe("<script>\nfunction save() {}\n</script>");
  });

  it("returns an empty array when no <script data-flowview> block is present", () => {
    const source = `<button>Save</button>\n<script>\nconst noop = () => {};\n</script>`;

    expect(findScriptFlowviewBlocks(source)).toHaveLength(0);
  });

  it("ignores a <script data-flowview> mention inside an HTML comment", () => {
    const source = `<!-- <script data-flowview>ignored</script> -->\n<button>Save</button>`;

    expect(findScriptFlowviewBlocks(source)).toHaveLength(0);
  });

  it("finds every block when more than one is present", () => {
    const source = `<script data-flowview>\nfunction a() {}\n</script>\n<script data-flowview>\nfunction b() {}\n</script>`;

    expect(findScriptFlowviewBlocks(source)).toHaveLength(2);
  });

  it("throws when the data-flowview attribute has a value", () => {
    const source = `<script data-flowview="true">\nfunction save() {}\n</script>`;

    expect(() => findScriptFlowviewBlocks(source)).toThrow(
      FlowviewViteEventsParseError,
    );
    expect(() => findScriptFlowviewBlocks(source)).toThrow(
      "must not have a value",
    );
  });

  it("finds data-flowview alongside other attributes", () => {
    const source = `<script type="module" data-flowview>\nfunction save() {}\n</script>`;
    const [block] = findScriptFlowviewBlocks(source);

    expect(block).toBeDefined();
    expect(block!.scriptSource).toBe("\nfunction save() {}\n");
  });
});
