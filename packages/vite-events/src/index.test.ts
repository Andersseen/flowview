import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileFlowview } from "@flowview/vite";
import { FlowviewDomError } from "@flowview/events";
import { describe, expect, it } from "vitest";
import type { Plugin } from "vite";
import flowviewEvents, {
  compileFlowviewEvents,
  FlowviewViteEventsError,
} from "./index.js";

describe("compileFlowviewEvents", () => {
  it("returns null for a file with no event bindings", () => {
    expect(
      compileFlowviewEvents("<button>Save</button>", { filename: "a.flow" }),
    ).toBeNull();
  });

  it("does not mistake a plain script's arrow function for an event binding", () => {
    const source = `<button>Save</button>\n<script>\nconst toggle = (icon) => (icon.style.display = "none");\n</script>`;

    expect(compileFlowviewEvents(source, { filename: "a.flow" })).toBeNull();
  });

  it("compiles a click handler, rewrites the binding, and strips the script block", () => {
    const source = `<button (click)="save($event)">Save</button>\n\n<script data-flowview>\nfunction save(event) {\n  console.log(event);\n}\n</script>`;

    const result = compileFlowviewEvents(source, { filename: "a.flow" });

    expect(result?.code).toContain('data-flow-on-click="save"');
    expect(result?.code).toMatch(/data-flow-scope="[0-9a-f]{12}"/);
    expect(result?.code).not.toContain("<script");
    expect(result?.script).toContain("function save(event)");
    expect(result?.script).toContain(
      'import { registerFlowHandlers } from "@flowview/events/runtime";',
    );
    expect(result?.script).toContain("registerFlowHandlers(");
  });

  it("supports a custom runtime import", () => {
    const source = `<button (click)="save()">Save</button>\n<script data-flowview>\nfunction save() {}\n</script>`;

    const result = compileFlowviewEvents(source, {
      filename: "a.flow",
      runtimeImport: "#flowview/runtime",
    });

    expect(result?.script).toContain(
      'import { registerFlowHandlers } from "#flowview/runtime";',
    );
  });

  it("uses the same scope id for every binding in the file", () => {
    const source = `<button (click)="save()">Save</button>\n<input (input)="search($event)" />\n<script data-flowview>\nfunction save() {}\nfunction search(event) {}\n</script>`;

    const result = compileFlowviewEvents(source, { filename: "a.flow" });

    const scopes = [
      ...(result?.code.matchAll(/data-flow-scope="([0-9a-f]{12})"/g) ?? []),
    ].map((match) => match[1]);
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toBe(scopes[1]);
    expect(result?.script).toContain('["click","input"]');
  });

  it("preserves unrelated template content around the rewritten binding", () => {
    const source = `<p>Intro</p>\n<button (click)="save()">Save</button>\n<p>Outro</p>\n<script data-flowview>\nfunction save() {}\n</script>`;

    const result = compileFlowviewEvents(source, { filename: "a.flow" });

    expect(result?.code).toContain("<p>Intro</p>");
    expect(result?.code).toContain("<p>Outro</p>");
  });

  it("reports a missing handler as a FlowviewDomError", () => {
    const source = `<button (click)="save()">Save</button>\n<script data-flowview>\nfunction other() {}\n</script>`;

    expect(() => compileFlowviewEvents(source, { filename: "a.flow" })).toThrow(
      FlowviewDomError,
    );
  });

  it("reports a helpful diagnostic for arrow function handlers", () => {
    const source = `<button (click)="save()">Save</button>\n<script data-flowview>\nconst save = () => {};\n</script>`;

    try {
      compileFlowviewEvents(source, { filename: "a.flow" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FlowviewDomError);
      expect((error as FlowviewDomError).diagnostics[0]?.message).toContain(
        "must be declared as a function",
      );
    }
  });

  it("reports a duplicate handler declaration", () => {
    const source = `<button (click)="save()">Save</button>\n<script data-flowview>\nfunction save() {}\nfunction save() {}\n</script>`;

    try {
      compileFlowviewEvents(source, { filename: "a.flow" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FlowviewDomError);
      expect((error as FlowviewDomError).diagnostics[0]?.message).toContain(
        "declared more than once",
      );
    }
  });

  it("errors when more than one <script data-flowview> block exists", () => {
    const source = `<button (click)="save()">Save</button>\n<script data-flowview>\nfunction save() {}\n</script>\n<script data-flowview>\nfunction other() {}\n</script>`;

    expect(() => compileFlowviewEvents(source, { filename: "a.flow" })).toThrow(
      FlowviewViteEventsError,
    );
    expect(() => compileFlowviewEvents(source, { filename: "a.flow" })).toThrow(
      "At most one <script data-flowview> block is allowed per file.",
    );
  });

  it("errors when the data-flowview attribute has a value", () => {
    const source = `<button (click)="save()">Save</button>\n<script data-flowview="true">\nfunction save() {}\n</script>`;

    expect(() => compileFlowviewEvents(source, { filename: "a.flow" })).toThrow(
      "must not have a value",
    );
  });

  it("errors when bindings exist but no <script data-flowview> block is present", () => {
    const source = `<button (click)="save()">Save</button>`;

    expect(() => compileFlowviewEvents(source, { filename: "a.flow" })).toThrow(
      "no <script data-flowview> block declares their handlers",
    );
  });
});

describe("@flowview/vite-events plugin", () => {
  function transformOf(plugin: Plugin) {
    const transform = plugin.transform;
    if (typeof transform !== "function") {
      throw new Error("flowview-events plugin has no transform hook");
    }
    return transform as (
      this: { error(e: unknown): never },
      code: string,
      id: string,
    ) => unknown;
  }

  it("ignores files that are not .flow", async () => {
    const plugin = flowviewEvents();
    const result = await transformOf(plugin).call(
      {
        error: () => {
          throw new Error("unexpected");
        },
      },
      `<button (click)="save()">Save</button>`,
      "/project/src/pages/example.astro",
    );
    expect(result).toBeNull();
  });

  it("ignores .flow files without event bindings", async () => {
    const plugin = flowviewEvents();
    const result = await transformOf(plugin).call(
      {
        error: () => {
          throw new Error("unexpected");
        },
      },
      `<button>Save</button>`,
      "/project/src/pages/example.flow",
    );
    expect(result).toBeNull();
  });

  it("transforms a .flow file and returns no sourcemap", async () => {
    const plugin = flowviewEvents();
    const source = `<button (click)="save()">Save</button>\n<script data-flowview>\nfunction save() {}\n</script>`;

    const result = await transformOf(plugin).call(
      {
        error: () => {
          throw new Error("unexpected");
        },
      },
      source,
      "/project/src/pages/example.flow",
    );

    expect(result).toMatchObject({ map: null });
    expect((result as { code: string }).code).toContain(
      'data-flow-on-click="save"',
    );
    expect((result as { code: string }).code).not.toContain("<script");
  });

  it("surfaces a located error when a handler is missing", async () => {
    const plugin = flowviewEvents();
    const source = `<button (click)="save()">Save</button>\n<script data-flowview>\nfunction other() {}\n</script>`;

    let thrown: unknown;
    try {
      await transformOf(plugin).call(
        {
          error: (e: unknown) => {
            throw e;
          },
        },
        source,
        "/project/src/pages/example.flow",
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      id: "/project/src/pages/example.flow",
      loc: { line: 1, column: 9 },
    });
  });

  it("resolves and loads the virtual events module for a file on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flowview-vite-events-"));
    const flowPath = join(dir, "index.flow");
    writeFileSync(
      flowPath,
      `<button (click)="save($event)">Save</button>\n<script data-flowview>\nfunction save(event) {\n  console.log(event);\n}\n</script>`,
      "utf8",
    );

    const plugin = flowviewEvents();
    (plugin.configResolved as (config: unknown) => void).call({} as never, {
      root: dir,
    });

    const publicId = "virtual:flowview-events/index.flow.ts";
    const resolved = (plugin.resolveId as (id: string) => string | null).call(
      {} as never,
      publicId,
    );
    expect(resolved).toBe("\0" + publicId);

    const loaded = await (plugin.load as (id: string) => unknown).call(
      {
        error: () => {
          throw new Error("unexpected");
        },
      },
      resolved as string,
    );

    expect(loaded).toContain("function save(event)");
    expect(loaded).toContain("registerFlowHandlers(");
  });

  it("invalidates the virtual module on handleHotUpdate", () => {
    const dir = "/project";
    const plugin = flowviewEvents();
    (plugin.configResolved as (config: unknown) => void).call({} as never, {
      root: dir,
    });

    const virtualModule = { id: "\0virtual:flowview-events/index.flow.ts" };
    let invalidated: unknown;
    const server = {
      moduleGraph: {
        getModuleById: (id: string) =>
          id === virtualModule.id ? virtualModule : undefined,
        invalidateModule: (module: unknown) => {
          invalidated = module;
        },
      },
    };

    const result = (plugin.handleHotUpdate as (ctx: unknown) => unknown).call(
      {} as never,
      {
        file: join(dir, "index.flow"),
        server,
        modules: [],
      },
    );

    expect(invalidated).toBe(virtualModule);
    expect(result).toContain(virtualModule);
  });
});

describe("integration with @flowview/vite's compiler", () => {
  it("compiles the rewritten template into a render() function with no script remnant", async () => {
    const source = `<button (click)="save($event)">Save</button>\n<script data-flowview>\nfunction save(event) {\n  console.log(event);\n}\n</script>`;

    const compiled = compileFlowviewEvents(source, {
      filename: "example.flow",
    });
    expect(compiled).not.toBeNull();
    expect(compiled?.code).not.toContain("<script");

    const { code } = await compileFlowview(compiled!.code, {
      filename: "example.flow",
      runtimeImport: "@flowview/runtime",
    });

    const render = evaluateGeneratedModule(code);
    const html = render({});

    expect(html).toContain('data-flow-on-click="save"');
    expect(html).toMatch(/data-flow-scope="[0-9a-f]{12}"/);
    expect(html).not.toContain("<script");
    expect(compiled?.script).toContain("function save(event)");
    expect(compiled?.script).toContain("registerFlowHandlers(");
  });
});

function evaluateGeneratedModule(
  code: string,
): (context: Record<string, unknown>) => string {
  const executable = code
    .replace(/^import \{ renderValue \} from '[^']+';\n\n/, "")
    .replace("export function render", "function render");
  const renderValue = (value: unknown): string => {
    if (value === null || value === undefined || value === false) return "";
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        (
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }) as Record<string, string>
        )[character] ?? character,
    );
  };

  return Function(
    "renderValue",
    `"use strict";\n${executable}\nreturn render;`,
  )(renderValue) as (context: Record<string, unknown>) => string;
}
