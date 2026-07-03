import { describe, expect, it } from "vitest";
import type { Plugin } from "vite";
import flowmarkEvents from "./index.js";

type ConfigSetupHook = (options: {
  updateConfig(config: { vite?: { plugins?: Plugin[] } }): void;
}) => void;

function createPlugin(): Plugin {
  let plugins: Plugin[] = [];
  const integration = flowmarkEvents();
  const setup = integration.hooks["astro:config:setup"] as ConfigSetupHook;

  setup({
    updateConfig(config) {
      plugins = config.vite?.plugins ?? [];
    },
  });

  const plugin = plugins.find(
    (candidate) => candidate.name === "@flowmark/astro-events:transform",
  );
  if (plugin === undefined) {
    throw new Error("Flowmark events plugin was not registered");
  }
  return plugin;
}

async function transformAstro(
  source: string,
  filename = "/src/pages/example.astro",
): Promise<string | null> {
  const result = await transformAstroResult(source, filename);
  return result?.code ?? null;
}

async function transformAstroResult(
  source: string,
  filename = "/src/pages/example.astro",
): Promise<{ code: string; map: unknown } | null> {
  const transform = createPlugin().transform;
  if (typeof transform !== "function") {
    throw new Error("Flowmark events plugin has no transform hook");
  }

  const result = await transform.call({} as never, source, filename);
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return { code: result, map: null };
  if (typeof result.code !== "string") {
    throw new Error("Flowmark events transform returned no code");
  }
  return { code: result.code, map: result.map };
}

describe("@flowmark/astro-events integration", () => {
  it("transforms a basic event binding", async () => {
    const result = await transformAstro(`---
function save() {
  console.log("saved");
}
---
<button (click)="save()">Save</button>`);

    expect(result).toContain('data-flow-on-click="save"');
    expect(result).toContain("import { bindFlowEvents }");
    expect(result).toContain("function save()");
    expect(result).toContain("bindFlowEvents({");
  });

  it("inlines the client module in a script tag", async () => {
    const transformed = await transformAstroResult(`---
function save() {
  console.log("saved");
}
---
<button (click)="save()">Save</button>`);

    expect(transformed?.code).toContain("<script>");
    expect(transformed?.code).toContain("import { bindFlowEvents }");
    expect(transformed?.code).toContain("function save()");
    expect(transformed?.code).toContain("bindFlowEvents({");
    expect(transformed?.code).toContain("</script>");
  });

  it("returns a source map for the transformed Astro file", async () => {
    const transformed = await transformAstroResult(`---
function save() {
  console.log("saved");
}
---
<button (click)="save()">Save</button>`);

    expect(transformed).not.toBeNull();
    expect(transformed?.map).not.toBeNull();
    expect(transformed?.map).toEqual(
      expect.objectContaining({
        mappings: expect.any(String),
        sources: expect.arrayContaining(["/src/pages/example.astro"]),
      }),
    );
    expect((transformed?.map as { mappings: string }).mappings).toBeTruthy();
  });

  it("escapes </script> sequences inside the injected client module", async () => {
    const transformed = await transformAstro(`---
function save() {
  const markup = "</script>";
  console.log(markup);
}
---
<button (click)="save()">Save</button>`);

    const scriptMatch = transformed?.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    const scriptContent = scriptMatch?.[1] ?? "";
    expect(scriptContent).not.toContain('"</script>"');
    expect(scriptContent).toContain('"<\\/script>"');
  });

  it("separates injected scripts from frontmatter", async () => {
    const transformed = await transformAstro(`---
function save() {}
---
<button (click)="save()">Save</button>`);

    expect(transformed).toContain("---\n<script>");
  });

  it("preserves existing frontmatter", async () => {
    const result = await transformAstro(`---
const title = "Hello";

function save() {
  console.log("saved");
}
---
<button (click)="save()">Save {title}</button>`);

    expect(result).toContain('const title = "Hello";');
    expect(result).toContain("Save {title}");
  });

  it("ignores Astro files without event bindings", async () => {
    const result = await transformAstro(`---
const title = "Hello";
---
<button>Save</button>`);

    expect(result).toBeNull();
  });

  it("reports a missing handler as a located error", async () => {
    await expect(
      transformAstro(`---
---
<button (click)="save()">Save</button>`),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        'Flowmark event handler "save" was used in the template',
      ),
      loc: expect.objectContaining({ line: expect.any(Number) }),
    });
  });

  it("reports missing handler locations relative to the original Astro file", async () => {
    await expect(
      transformAstro(`---
---
<button (click)="save()">Save</button>`),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        'Flowmark event handler "save" was used in the template',
      ),
      loc: { line: 3, column: 9 },
    });
  });

  it("reports a captured server value as a located error", async () => {
    await expect(
      transformAstro(`---
const prefix = "item:";

function save(id: string) {
  console.log(prefix + id);
}
---
<button (click)="save('1')">Save</button>`),
    ).rejects.toMatchObject({
      message: expect.stringContaining('captures "prefix"'),
    });
  });
});
