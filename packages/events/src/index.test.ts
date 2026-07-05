import { describe, expect, it } from "vitest";
import {
  applyTemplateEdits,
  compileScriptEvents,
  FlowviewDomError,
} from "./index.js";

describe("compileScriptEvents", () => {
  function fixture(bindingsHtml: string, scriptSource: string) {
    const template = `${bindingsHtml}\n\n<script data-flowview>${scriptSource}</script>\n`;
    const scriptOffset = template.indexOf(scriptSource);
    return { template, scriptOffset, scriptSource };
  }

  it("compiles a basic click handler declared in a script flowview block", () => {
    const { template, scriptOffset, scriptSource } = fixture(
      `<button (click)="save($event)">Save</button>`,
      `\nfunction save(event) {\n  console.log(event);\n}\n`,
    );

    const result = compileScriptEvents({
      filename: "test.astro",
      scope: "abc123",
      template,
      scriptOffset,
      scriptSource,
    });

    const html = applyTemplateEdits(template, result.templateEdits);
    expect(html).toContain('data-flow-on-click="save"');
    expect(html).toContain('data-flow-scope="abc123"');
    expect(result.events).toEqual(["click"]);
    expect(result.scriptAppend).toContain(
      'import { registerFlowHandlers } from "@flowview/events/runtime";',
    );
    expect(result.scriptAppend).toContain(
      'registerFlowHandlers("abc123", { save }, ["click"]);',
    );
  });

  it("supports a custom runtime import", () => {
    const { template, scriptOffset, scriptSource } = fixture(
      `<button (click)="save()">Save</button>`,
      `\nfunction save() {}\n`,
    );

    const result = compileScriptEvents({
      filename: "test.astro",
      scope: "abc123",
      template,
      scriptOffset,
      scriptSource,
      runtimeImport: "#flowview/runtime",
    });

    expect(result.scriptAppend).toContain(
      'import { registerFlowHandlers } from "#flowview/runtime";',
    );
  });

  it("supports two independent bindings and reports both event names", () => {
    const { template, scriptOffset, scriptSource } = fixture(
      `<button (click)="save()">Save</button>\n<input (input)="search($event)" />`,
      `\nfunction save() {}\nfunction search(event) {}\n`,
    );

    const result = compileScriptEvents({
      filename: "test.astro",
      scope: "scope-1",
      template,
      scriptOffset,
      scriptSource,
    });

    const html = applyTemplateEdits(template, result.templateEdits);
    expect(html).toContain('data-flow-on-click="save"');
    expect(html).toContain('data-flow-on-input="search"');
    expect(html).toContain('data-flow-scope="scope-1"');
    expect(result.events).toEqual(["click", "input"]);
    expect(result.scriptAppend).toContain("{ save, search }");
  });

  it("throws a diagnostic for a handler missing from the script block", () => {
    const { template, scriptOffset, scriptSource } = fixture(
      `<button (click)="save()">Save</button>`,
      `\nfunction other() {}\n`,
    );

    let caught: FlowviewDomError | undefined;
    try {
      compileScriptEvents({
        filename: "test.astro",
        scope: "abc",
        template,
        scriptOffset,
        scriptSource,
      });
    } catch (error) {
      caught = error as FlowviewDomError;
    }

    expect(caught).toBeInstanceOf(FlowviewDomError);
    expect(caught?.diagnostics[0]?.message).toContain(
      "was used in the template but was not found in the <script data-flowview> block",
    );
  });

  it("reports a helpful diagnostic for arrow function handlers", () => {
    const { template, scriptOffset, scriptSource } = fixture(
      `<button (click)="save()">Save</button>`,
      `\nconst save = () => {};\n`,
    );

    let caught: FlowviewDomError | undefined;
    try {
      compileScriptEvents({
        filename: "test.astro",
        scope: "abc",
        template,
        scriptOffset,
        scriptSource,
      });
    } catch (error) {
      caught = error as FlowviewDomError;
    }

    expect(caught).toBeInstanceOf(FlowviewDomError);
    expect(caught?.diagnostics[0]?.message).toContain(
      "must be declared as a function",
    );
  });

  it("throws a diagnostic when a handler name is declared twice", () => {
    const { template, scriptOffset, scriptSource } = fixture(
      `<button (click)="save()">Save</button>`,
      `\nfunction save() {}\nfunction save() {}\n`,
    );

    let caught: FlowviewDomError | undefined;
    try {
      compileScriptEvents({
        filename: "test.astro",
        scope: "abc",
        template,
        scriptOffset,
        scriptSource,
      });
    } catch (error) {
      caught = error as FlowviewDomError;
    }

    expect(caught).toBeInstanceOf(FlowviewDomError);
    expect(caught?.diagnostics[0]?.message).toContain(
      "declared more than once in the <script data-flowview> block",
    );
  });

  it("throws for unsupported arguments", () => {
    const { template, scriptOffset, scriptSource } = fixture(
      `<button (click)="save([1, 2])">Save</button>`,
      `\nfunction save(list) {}\n`,
    );

    expect(() =>
      compileScriptEvents({
        filename: "test.astro",
        scope: "abc",
        template,
        scriptOffset,
        scriptSource,
      }),
    ).toThrow(FlowviewDomError);
  });

  it("keeps diagnostic locations correct when the script is not at the start of the template", () => {
    const scriptSource = `\nfunction save() {}\nfunction save() {}\n`;
    const template = `<p>Intro text</p>\n\n<button (click)="save()">Save</button>\n\n<script data-flowview>${scriptSource}</script>\n`;
    const scriptOffset = template.indexOf(scriptSource);

    const secondDeclarationOffset = template.lastIndexOf("function save");
    const expectedLine = template
      .slice(0, secondDeclarationOffset)
      .split("\n").length;

    let caught: FlowviewDomError | undefined;
    try {
      compileScriptEvents({
        filename: "test.astro",
        scope: "abc",
        template,
        scriptOffset,
        scriptSource,
      });
    } catch (error) {
      caught = error as FlowviewDomError;
    }

    expect(caught).toBeInstanceOf(FlowviewDomError);
    expect(caught?.diagnostics[0]?.line).toBe(expectedLine);
  });
});
