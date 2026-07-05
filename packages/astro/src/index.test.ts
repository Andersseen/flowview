import { describe, expect, it } from "vitest";
import type { Plugin } from "vite";
import flowview from "./index";

type ConfigSetupHook = (options: {
  updateConfig(config: { vite?: { plugins?: Plugin[] } }): void;
}) => void;

function createEmbeddedPlugin(): Plugin {
  let plugins: Plugin[] = [];
  const integration = flowview();
  const setup = integration.hooks["astro:config:setup"] as ConfigSetupHook;

  setup({
    updateConfig(config) {
      plugins = config.vite?.plugins ?? [];
    },
  });

  const plugin = plugins.find(
    (candidate) => candidate.name === "@flowview/astro:embedded",
  );
  if (plugin === undefined) {
    throw new Error("flowview embedded plugin was not registered");
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
  const transform = createEmbeddedPlugin().transform;
  if (typeof transform !== "function") {
    throw new Error("flowview embedded plugin has no transform hook");
  }

  const result = await transform.call({} as never, source, filename);
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return { code: result, map: null };
  if (typeof result.code !== "string") {
    throw new Error("flowview transform returned no code");
  }
  return { code: result.code, map: result.map };
}

describe("flowview Astro integration", () => {
  it("transforms inline templates and preserves existing frontmatter", async () => {
    const result = await transformAstro(`---
const context = { title: "Hello" };
---
<template flowview is:raw context={context}>
  <h1>{{ context.title }}</h1>
</template>`);

    expect(result).toContain(
      'import { render as __flowviewRender0 } from "virtual:flowview-astro/',
    );
    expect(result).toContain(
      "<Fragment set:html={__flowviewRender0(context)} />",
    );
    expect(result).toMatch(/^---\nconst context[\s\S]+\n---\n<Fragment/);
  });

  it("creates frontmatter when an Astro file does not have it", async () => {
    const result = await transformAstro(
      `<template flowview context={{ title: "Hello" }}><h1>{{ context.title }}</h1></template>`,
    );

    expect(result).toMatch(/^---\nimport \{ render as __flowviewRender0/);
    expect(result).toContain(
      '<Fragment set:html={__flowviewRender0({ title: "Hello" })} />',
    );
  });

  it("supports multiple independent inline templates", async () => {
    const result = await transformAstro(`---
const first = { value: "A" };
const second = { value: "B" };
---
<template flowview context={first}>{{ context.value }}</template>
<template flowview context={second}>{{ context.value }}</template>`);

    expect(result?.match(/import \{ render as __flowviewRender/g)).toHaveLength(
      2,
    );
    expect(result).toContain("__flowviewRender0(first)");
    expect(result).toContain("__flowviewRender1(second)");
  });

  it("uses Astro's parser for complex context expressions and returns a source map", async () => {
    const filename = "/src/pages/filtered.astro";
    const result = await transformAstroResult(
      `<template flowview is:raw context={{ items: source.filter((item) => item.score > 1) }}>{{ context.items.length }}</template>`,
      filename,
    );

    expect(result?.code).toContain(
      "__flowviewRender0({ items: source.filter((item) => item.score > 1) })",
    );
    expect(result?.map).toMatchObject({
      sources: [filename],
      sourcesContent: [expect.stringContaining("<template flowview")],
    });
  });

  it("ignores comments, raw-text elements, and similarly named tags", async () => {
    const result = await transformAstro(`<!--
<template flowview context={context}>ignored</template>
-->
<script>const example = "<template flowview context={context}>";</script>
<style>.example::after { content: "<template flowview>"; }</style>
<template-card flowview>not a flowview template</template-card>`);

    expect(result).toBeNull();
  });

  it("does not close an inline template from comments or raw-text content", async () => {
    const result = await transformAstro(`---
const context = { title: "Hello" };
---
<template flowview context={context}>
  <!-- </template> -->
  <script>const marker = "</template>";</script>
  <template><span>Nested HTML template</span></template>
  <h1>{{ context.title }}</h1>
</template>
<p id="after">After</p>`);

    expect(result).toContain(
      '<Fragment set:html={__flowviewRender0(context)} />\n<p id="after">After</p>',
    );
    expect(result).not.toContain("Nested HTML template");
  });

  it("supports the short flowview={...} context form", async () => {
    const result = await transformAstro(`---
const context = { title: "Hello" };
---
<template flowview={context} is:raw>
  <h1>{{ context.title }}</h1>
</template>`);

    expect(result).toContain(
      "<Fragment set:html={__flowviewRender0(context)} />",
    );
  });

  it("supports inline object expressions in the short form", async () => {
    const result = await transformAstro(
      `<template flowview={{ title: "Hello" }}><h1>{{ context.title }}</h1></template>`,
    );

    expect(result).toContain(
      '<Fragment set:html={__flowviewRender0({ title: "Hello" })} />',
    );
  });

  it("rejects combining flowview={...} with context={...}", async () => {
    await expect(
      transformAstro(
        "<template flowview={a} context={b}><p>{{ context.x }}</p></template>",
      ),
    ).rejects.toThrow("must not combine");
  });

  it("requires context and a closing template tag", async () => {
    await expect(
      transformAstro("<template flowview><p>Missing context</p></template>"),
    ).rejects.toThrow("require a context expression");

    await expect(
      transformAstro(
        "<template flowview context={  }><p>Empty context</p></template>",
      ),
    ).rejects.toThrow("require a context expression");

    await expect(
      transformAstro(
        "<template flowview context={context}><p>Missing close</p>",
      ),
    ).rejects.toThrow("missing </template>");
  });

  it("accepts case-insensitive template closing tags", async () => {
    const result = await transformAstro(
      `<template flowview context={context}><p>{{ context.title }}</p></TEMPLATE>`,
    );

    expect(result).toContain(
      "<Fragment set:html={__flowviewRender0(context)} />",
    );
  });

  it("throws a located error when context is missing", async () => {
    await expect(
      transformAstro("<template flowview><p>Missing context</p></template>"),
    ).rejects.toMatchObject({
      message: expect.stringContaining("context={...}"),
      loc: expect.objectContaining({ line: 1, column: expect.any(Number) }),
    });
  });
});
