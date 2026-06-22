import { describe, expect, it } from "vitest";
import type { Plugin } from "vite";
import flowmark from "./index";

type ConfigSetupHook = (options: {
  updateConfig(config: { vite?: { plugins?: Plugin[] } }): void;
}) => void;

function createEmbeddedPlugin(): Plugin {
  let plugins: Plugin[] = [];
  const integration = flowmark();
  const setup = integration.hooks["astro:config:setup"] as ConfigSetupHook;

  setup({
    updateConfig(config) {
      plugins = config.vite?.plugins ?? [];
    },
  });

  const plugin = plugins.find(
    (candidate) => candidate.name === "@flowmark/astro:embedded",
  );
  if (plugin === undefined) {
    throw new Error("Flowmark embedded plugin was not registered");
  }
  return plugin;
}

async function transformAstro(
  source: string,
  filename = "/src/pages/example.astro",
): Promise<string | null> {
  const transform = createEmbeddedPlugin().transform;
  if (typeof transform !== "function") {
    throw new Error("Flowmark embedded plugin has no transform hook");
  }

  const result = await transform.call({} as never, source, filename);
  if (result === null || result === undefined) return null;
  return typeof result === "string" ? result : (result.code ?? null);
}

describe("Flowmark Astro integration", () => {
  it("transforms inline templates and preserves existing frontmatter", async () => {
    const result = await transformAstro(`---
const context = { title: "Hello" };
---
<template flowmark is:raw context={context}>
  <h1>{{ context.title }}</h1>
</template>`);

    expect(result).toContain(
      'import { render as __flowmarkRender0 } from "virtual:flowmark-astro/',
    );
    expect(result).toContain(
      "<Fragment set:html={__flowmarkRender0(context)} />",
    );
    expect(result).toMatch(/^---\nconst context[\s\S]+\n---\n<Fragment/);
  });

  it("creates frontmatter when an Astro file does not have it", async () => {
    const result = await transformAstro(
      `<template flowmark context={{ title: "Hello" }}><h1>{{ context.title }}</h1></template>`,
    );

    expect(result).toMatch(/^---\nimport \{ render as __flowmarkRender0/);
    expect(result).toContain(
      '<Fragment set:html={__flowmarkRender0({ title: "Hello" })} />',
    );
  });

  it("supports multiple independent inline templates", async () => {
    const result = await transformAstro(`---
const first = { value: "A" };
const second = { value: "B" };
---
<template flowmark context={first}>{{ context.value }}</template>
<template flowmark context={second}>{{ context.value }}</template>`);

    expect(result?.match(/import \{ render as __flowmarkRender/g)).toHaveLength(
      2,
    );
    expect(result).toContain("__flowmarkRender0(first)");
    expect(result).toContain("__flowmarkRender1(second)");
  });

  it("ignores comments, raw-text elements, and similarly named tags", async () => {
    const result = await transformAstro(`<!--
<template flowmark context={context}>ignored</template>
-->
<script>const example = "<template flowmark context={context}>";</script>
<style>.example::after { content: "<template flowmark>"; }</style>
<template-card flowmark>not a Flowmark template</template-card>`);

    expect(result).toBeNull();
  });

  it("does not close an inline template from comments or raw-text content", async () => {
    const result = await transformAstro(`---
const context = { title: "Hello" };
---
<template flowmark context={context}>
  <!-- </template> -->
  <script>const marker = "</template>";</script>
  <template><span>Nested HTML template</span></template>
  <h1>{{ context.title }}</h1>
</template>
<p id="after">After</p>`);

    expect(result).toContain(
      '<Fragment set:html={__flowmarkRender0(context)} />\n<p id="after">After</p>',
    );
    expect(result).not.toContain("Nested HTML template");
  });

  it("requires context and a closing template tag", async () => {
    await expect(
      transformAstro("<template flowmark><p>Missing context</p></template>"),
    ).rejects.toThrow("require a non-empty context={...} attribute");

    await expect(
      transformAstro(
        "<template flowmark context={  }><p>Empty context</p></template>",
      ),
    ).rejects.toThrow("require a non-empty context={...} attribute");

    await expect(
      transformAstro(
        "<template flowmark context={context}><p>Missing close</p>",
      ),
    ).rejects.toThrow("missing </template>");
  });
});
