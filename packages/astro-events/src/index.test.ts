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
    (candidate) => candidate.name === "@flowview/astro-events:transform",
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

describe("@flowview/astro-events integration", () => {
  it("ignores Astro files without event bindings", async () => {
    const result = await transformAstro(`---
const title = "Hello";
---
<button>Save</button>`);

    expect(result).toBeNull();
  });

  it("does not mistake a script's arrow function for an event binding", async () => {
    // `(icon) => (icon.style.display = ...)` inside a plain <script> looks
    // like `(event)=` to a naive regex; findEventBindings correctly skips
    // script tag content, so this must remain a no-op.
    const result = await transformAstro(`---
---
<button>Save</button>

<script is:inline>
  const toggle = (icon) => (icon.style.display = "none");
</script>`);

    expect(result).toBeNull();
  });

  it("compiles bindings declared in a <script data-flowmark> block", async () => {
    const result = await transformAstroResult(`---
---
<button (click)="save($event)">Save</button>

<script data-flowmark>
  function save(event) {
    console.log(event);
  }
</script>`);

    expect(result?.code).toContain('data-flow-on-click="save"');
    expect(result?.code).toMatch(/data-flow-scope="[0-9a-f]{12}"/);
    expect(result?.code).toContain(
      'import { registerFlowHandlers } from "@flowview/events/runtime";',
    );
    expect(result?.code).toContain("registerFlowHandlers(");
    expect(result?.code).toContain("function save(event)");
    expect(result?.code).not.toContain("<script data-flowmark>");
  });

  it("returns a source map for the transformed Astro file", async () => {
    const transformed = await transformAstroResult(`---
---
<button (click)="save()">Save</button>

<script data-flowmark>
  function save() {}
</script>`);

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

  it("preserves existing frontmatter and unrelated template content", async () => {
    const result = await transformAstro(`---
const title = "Hello";
---
<button (click)="save()">Save {title}</button>

<script data-flowmark>
  function save() {}
</script>`);

    expect(result).toContain('const title = "Hello";');
    expect(result).toContain("Save {title}");
  });

  it("locates the script block correctly when multi-byte characters precede it", async () => {
    // "@astrojs/compiler" reports UTF-8 byte offsets; an em dash (3 bytes,
    // 1 UTF-16 code unit) before the script block previously desynced every
    // offset computed after it.
    const result = await transformAstroResult(`---
---
<p>An em dash — right here.</p>
<button (click)="save($event)">Save</button>

<script data-flowmark>
  function save(event) {
    console.log(event);
  }
</script>`);

    expect(result?.code).toContain("<script>");
    expect(result?.code).toContain("function save(event)");
    expect(result?.code).toContain('data-flow-on-click="save"');
    expect(result?.code).toContain("registerFlowHandlers(");
    expect(result?.code).not.toContain("data-flowmark");
  });

  it("uses the same scope id for every binding in the file", async () => {
    const result = await transformAstroResult(`---
---
<button (click)="save()">Save</button>
<input (input)="search($event)" />

<script data-flowmark>
  function save() {}
  function search(event) {}
</script>`);

    const scopes = [
      ...(result?.code.matchAll(/data-flow-scope="([0-9a-f]{12})"/g) ?? []),
    ].map((match) => match[1]);
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toBe(scopes[1]);
    expect(result?.code).toContain("registerFlowHandlers(");
    expect(result?.code).toContain('["click","input"]');
  });

  it("reports a missing handler as a located error", async () => {
    await expect(
      transformAstro(`---
---
<button (click)="save()">Save</button>

<script data-flowmark>
  function other() {}
</script>`),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "was used in the template but was not found in the <script data-flowmark> block",
      ),
      loc: { line: 3, column: 9 },
    });
  });

  it("reports a duplicate handler declaration as a located error", async () => {
    await expect(
      transformAstro(`---
---
<button (click)="save()">Save</button>

<script data-flowmark>
  function save() {}
  function save() {}
</script>`),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "declared more than once in the <script data-flowmark> block",
      ),
    });
  });

  it("reports a helpful diagnostic for arrow function handlers", async () => {
    await expect(
      transformAstro(`---
---
<button (click)="save()">Save</button>

<script data-flowmark>
  const save = () => {};
</script>`),
    ).rejects.toMatchObject({
      message: expect.stringContaining("must be declared as a function"),
    });
  });

  it("errors when more than one <script data-flowmark> block exists", async () => {
    await expect(
      transformAstro(`---
---
<button (click)="save()">Save</button>

<script data-flowmark>
  function save() {}
</script>

<script data-flowmark>
  function other() {}
</script>`),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "At most one <script data-flowmark> block is allowed per file.",
      ),
    });
  });

  it("errors when the flowmark attribute has a value", async () => {
    await expect(
      transformAstro(`---
---
<button (click)="save()">Save</button>

<script data-flowmark="true">
  function save() {}
</script>`),
    ).rejects.toMatchObject({
      message: expect.stringContaining("must not have a value"),
    });
  });

  it("errors when bindings exist but no <script data-flowmark> block is present", async () => {
    await expect(
      transformAstro(`---
---
<button (click)="save()">Save</button>`),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "no <script data-flowmark> block declares their handlers",
      ),
    });
  });
});
