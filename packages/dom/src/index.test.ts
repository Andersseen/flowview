import { describe, expect, it } from "vitest";
import { compileEvents, FlowmarkDomError } from "./index.js";

describe("compileEvents", () => {
  it("compiles a basic click handler", () => {
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: `\nfunction save() {\n  console.log("saved");\n}\n`,
      template: `\n<button (click)="save()">Save</button>\n`,
    });

    expect(result.html).toContain('data-flow-on-click="save"');
    expect(result.clientModule).toContain("import { bindFlowEvents }");
    expect(result.clientModule).toContain("function save()");
    expect(result.clientModule).toContain("bindFlowEvents({");
    expect(result.clientModule).toContain("save,");
  });

  it("compiles a handler with $event", () => {
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: `\nfunction save(event: Event) {\n  console.log(event.type);\n}\n`,
      template: `\n<button (click)="save($event)">Save</button>\n`,
    });

    expect(result.html).toContain('data-flow-on-click="save"');
    expect(result.html).toContain(
      'data-flow-args="[{&quot;__flow&quot;:&quot;$event&quot;}]"',
    );
    expect(result.clientModule).toContain("function save(event)");
    expect(result.clientModule).not.toContain("event: Event");
  });

  it("compiles a handler with static literal arguments", () => {
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: `\nfunction removeItem(id: string) {\n  console.log(id);\n}\n`,
      template: `\n<button (click)="removeItem('item-1')">Remove</button>\n`,
    });

    expect(result.html).toContain('data-flow-on-click="removeItem"');
    expect(result.html).toContain('data-flow-args="[&quot;item-1&quot;]"');
    expect(result.clientModule).toContain("function removeItem(id)");
    expect(result.clientModule).not.toContain("id: string");
  });

  it("supports multiple handlers and events", () => {
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: `\nfunction save() {\n  console.log("saved");\n}\nfunction cancel() {\n  console.log("cancelled");\n}\n`,
      template: `\n<button (click)="save()">Save</button>\n<button (click)="cancel()">Cancel</button>\n`,
    });

    expect(result.html).toContain('data-flow-on-click="save"');
    expect(result.html).toContain('data-flow-on-click="cancel"');
    expect(result.clientModule).toContain("function save()");
    expect(result.clientModule).toContain("function cancel()");
  });

  it("returns unchanged HTML when no event bindings exist", () => {
    const template = `\n<button>Save</button>\n`;
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: "",
      template,
    });

    expect(result.html).toBe(template);
    expect(result.clientModule).toBe("");
  });

  it("throws a diagnostic for a missing handler", () => {
    expect(() =>
      compileEvents({
        filename: "test.astro",
        frontmatter: "",
        template: `\n<button (click)="save()">Save</button>\n`,
      }),
    ).toThrow(FlowmarkDomError);

    try {
      compileEvents({
        filename: "test.astro",
        frontmatter: "",
        template: `\n<button (click)="save()">Save</button>\n`,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(FlowmarkDomError);
      const diagnostic = (error as FlowmarkDomError).diagnostics[0];
      expect(diagnostic?.message).toContain(
        'Flowmark event handler "save" was used in the template',
      );
    }
  });

  it("throws a diagnostic for a handler that captures a server value", () => {
    expect(() =>
      compileEvents({
        filename: "test.astro",
        frontmatter: `\nconst prefix = "item:";\nfunction save(id: string) {\n  console.log(prefix + id);\n}\n`,
        template: `\n<button (click)="save('1')">Save</button>\n`,
      }),
    ).toThrow(FlowmarkDomError);

    try {
      compileEvents({
        filename: "test.astro",
        frontmatter: `\nconst prefix = "item:";\nfunction save(id: string) {\n  console.log(prefix + id);\n}\n`,
        template: `\n<button (click)="save('1')">Save</button>\n`,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(FlowmarkDomError);
      const diagnostic = (error as FlowmarkDomError).diagnostics[0];
      expect(diagnostic?.message).toContain('captures "prefix"');
    }
  });

  it("throws for unsupported inline expressions", () => {
    expect(() =>
      compileEvents({
        filename: "test.astro",
        frontmatter: `\nfunction save() {}\n`,
        template: `\n<button (click)="count++; save()">Save</button>\n`,
      }),
    ).toThrow(FlowmarkDomError);
  });

  it("throws for unsupported arguments", () => {
    expect(() =>
      compileEvents({
        filename: "test.astro",
        frontmatter: `\nfunction save(value: string) {\n  console.log(value);\n}\n`,
        template: `\n<input (input)="search($event.target.value)" />\n`,
      }),
    ).toThrow(FlowmarkDomError);
  });

  it("throws for trailing content after a valid handler call", () => {
    expect(() =>
      compileEvents({
        filename: "test.astro",
        frontmatter: `\nfunction save() {}\n`,
        template: `\n<button (click)="save() + 1">Save</button>\n`,
      }),
    ).toThrow(FlowmarkDomError);
  });

  it("throws for trailing identifiers after a valid handler call", () => {
    expect(() =>
      compileEvents({
        filename: "test.astro",
        frontmatter: `\nfunction save() {}\n`,
        template: `\n<button (click)="save()foo">Save</button>\n`,
      }),
    ).toThrow(FlowmarkDomError);
  });

  it("ignores event-like attributes inside HTML comments", () => {
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: "",
      template: `<!-- <button (click)="save()">Save</button> -->`,
    });

    expect(result.html).toBe(
      `<!-- <button (click)="save()">Save</button> -->`,
    );
    expect(result.clientModule).toBe("");
  });

  it("ignores event-like attributes inside script tags", () => {
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: "",
      template: `<script>const el = '<button (click)="save()">Save</button>';</script>`,
    });

    expect(result.html).toBe(
      `<script>const el = '<button (click)="save()">Save</button>';</script>`,
    );
    expect(result.clientModule).toBe("");
  });

  it("handles mixed attributes including non-event bindings", () => {
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: `\nfunction save() {}\n`,
      template: `<button id="btn" class="primary" (click)="save()" disabled>Save</button>`,
    });

    expect(result.html).toContain('data-flow-on-click="save"');
    expect(result.html).toContain('id="btn"');
    expect(result.html).toContain('class="primary"');
    expect(result.html).toContain('disabled');
    expect(result.clientModule).toContain("function save()");
  });

  it("handles event attributes with single quotes", () => {
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: `\nfunction save() {}\n`,
      template: `<button (click)='save()'>Save</button>`,
    });

    expect(result.html).toContain('data-flow-on-click="save"');
  });

  it("does not treat text content as event attributes", () => {
    const result = compileEvents({
      filename: "test.astro",
      frontmatter: "",
      template: `<p>Use (click)="save()" syntax.</p>`,
    });

    expect(result.clientModule).toBe("");
  });
});
