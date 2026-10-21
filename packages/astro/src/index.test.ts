import { describe, expect, it } from "vitest";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { Plugin } from "vite";
import {
  renderAttributeValue,
  renderRawValue,
  renderValue,
} from "../../runtime/src/render-value";
import flowview from "./index";
import { findEmbeddedTemplates } from "./embedded-regions.js";

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
  plugin = createEmbeddedPlugin(),
): Promise<{ code: string; map: unknown } | null> {
  const transform = plugin.transform;
  const handler =
    typeof transform === "function" ? transform : transform?.handler;
  if (typeof handler !== "function") {
    throw new Error("flowview embedded plugin has no transform hook");
  }

  const result = await handler.call({} as never, source, filename);
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return { code: result, map: null };
  if (typeof result.code !== "string") {
    throw new Error("flowview transform returned no code");
  }
  return { code: result.code, map: result.map };
}

describe("flowview Astro integration", () => {
  // @spec SPEC-HTML-101
  it("shares AST-based region discovery with editor tooling and maps Unicode offsets", () => {
    const source = `---\nconst context = {};\n---\n<p>é🙂</p>\n<template flowview is:raw context={context}>one</template>\n<script>const s = "<template flowview>";</script>\n<template flowview={context} is:raw>two</template>`;
    const regions = findEmbeddedTemplates(source, "Page.astro");
    expect(regions).toHaveLength(2);
    expect(regions.map((region) => region.source)).toEqual(["one", "two"]);
    expect(source.slice(regions[0]!.bodyStart, regions[0]!.bodyStart + 3)).toBe(
      "one",
    );
    expect(source.slice(regions[1]!.bodyStart, regions[1]!.bodyStart + 3)).toBe(
      "two",
    );
  });

  // @spec SPEC-HTML-092
  it("orders embedded template transforms after flowview events when both integrations are installed", () => {
    const plugin = createEmbeddedPlugin();
    const plugins: Plugin[] = [
      { name: "@flowview/vite" },
      plugin,
      { name: "@flowview/astro-events:transform" },
      { name: "astro:build" },
    ];

    if (typeof plugin.configResolved !== "function") {
      throw new Error("flowview embedded plugin has no configResolved hook");
    }
    plugin.configResolved.call({} as never, { plugins } as never);

    expect(plugins.map((candidate) => candidate.name)).toEqual([
      "@flowview/vite",
      "@flowview/astro-events:transform",
      "@flowview/astro:embedded",
      "astro:build",
    ]);
  });

  // @spec SPEC-HTML-087 SPEC-HTML-090
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

  // @spec SPEC-HTML-089 SPEC-HTML-090
  it("creates frontmatter when an Astro file does not have it", async () => {
    const result = await transformAstro(
      `<template flowview context={{ title: "Hello" }}><h1>{{ context.title }}</h1></template>`,
    );

    expect(result).toMatch(/^---\nimport \{ render as __flowviewRender0/);
    expect(result).toContain(
      '<Fragment set:html={__flowviewRender0({ title: "Hello" })} />',
    );
  });

  // @spec SPEC-HTML-087
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

  // @spec SPEC-HTML-037 SPEC-HTML-087
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

  // @spec SPEC-HTML-035
  it("maps generated expressions in an embedded @for back to the host Astro file", async () => {
    const filename = "/src/pages/list.astro";
    const source = `---\nconst context = { items: [{ title: "A" }] };\n---\n<template flowview context={context}>\n  @for (item of context.items) {\n    <h2>{{ item.title }}</h2>\n  }\n</template>`;
    const plugin = createEmbeddedPlugin();
    if (typeof plugin.configResolved === "function") {
      plugin.configResolved.call(
        {} as never,
        { root: "/", plugins: [plugin] } as never,
      );
    }
    const transformed = await transformAstroResult(source, filename, plugin);
    const virtualId = transformed?.code.match(
      /from "(virtual:flowview-astro\/[^"]+)"/,
    )?.[1];
    if (
      !virtualId ||
      typeof plugin.load !== "function" ||
      typeof plugin.resolveId !== "function"
    ) {
      throw new Error("embedded virtual module was not registered");
    }
    const resolveId = plugin.resolveId as (
      this: unknown,
      id: string,
      importer?: string,
      options?: unknown,
    ) => string | null;
    const resolvedId = resolveId.call({}, virtualId, undefined, {});
    if (typeof resolvedId !== "string")
      throw new Error("virtual module did not resolve");
    const loaded = await plugin.load.call({} as never, resolvedId);
    if (typeof loaded !== "object" || loaded === null || !("code" in loaded)) {
      throw new Error(
        `embedded module returned no compiler map: ${JSON.stringify(loaded)}`,
      );
    }
    const code = loaded.code as string;
    const map = loaded.map as ConstructorParameters<typeof TraceMap>[0] & {
      sourcesContent?: (string | null)[];
    };
    const offset = code.indexOf("item.title");
    const before = code.slice(0, offset);
    const position = originalPositionFor(new TraceMap(map), {
      line: before.split("\n").length,
      column: before.length - before.lastIndexOf("\n") - 1,
    });

    expect(position).toMatchObject({ source: "src/pages/list.astro", line: 6 });
    expect(map.sourcesContent?.[0]).toBe(source);
    expect(position?.source).not.toContain("virtual:flowview-astro");
  });

  // @spec SPEC-HTML-095
  it("ignores comments, raw-text elements, and similarly named tags", async () => {
    const result = await transformAstro(`<!--
<template flowview context={context}>ignored</template>
-->
<script>const example = "<template flowview context={context}>";</script>
<style>.example::after { content: "<template flowview>"; }</style>
<template-card flowview>not a flowview template</template-card>`);

    expect(result).toBeNull();
  });

  // @spec SPEC-HTML-095
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

  // @spec SPEC-HTML-088
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

  // @spec SPEC-HTML-088
  it("supports inline object expressions in the short form", async () => {
    const result = await transformAstro(
      `<template flowview={{ title: "Hello" }}><h1>{{ context.title }}</h1></template>`,
    );

    expect(result).toContain(
      '<Fragment set:html={__flowviewRender0({ title: "Hello" })} />',
    );
  });

  // @spec SPEC-HTML-088
  it("rejects combining flowview={...} with context={...}", async () => {
    await expect(
      transformAstro(
        "<template flowview={a} context={b}><p>{{ context.x }}</p></template>",
      ),
    ).rejects.toThrow("must not combine");
  });

  // @spec SPEC-HTML-094
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

  // @spec SPEC-HTML-095
  it("accepts case-insensitive template closing tags", async () => {
    const result = await transformAstro(
      `<template flowview context={context}><p>{{ context.title }}</p></TEMPLATE>`,
    );

    expect(result).toContain(
      "<Fragment set:html={__flowviewRender0(context)} />",
    );
  });

  // @spec SPEC-HTML-094
  it("throws a located error when context is missing", async () => {
    await expect(
      transformAstro("<template flowview><p>Missing context</p></template>"),
    ).rejects.toMatchObject({
      message: expect.stringContaining("context={...}"),
      loc: expect.objectContaining({ line: 1, column: expect.any(Number) }),
    });
  });

  // @spec SPEC-HTML-087
  it("compiles raw interpolation in embedded templates", async () => {
    const plugin = createEmbeddedPlugin();
    const transform = plugin.transform;
    const handler =
      typeof transform === "function" ? transform : transform?.handler;
    if (typeof handler !== "function") {
      throw new Error("flowview embedded plugin has no transform hook");
    }

    const result = await handler.call(
      {} as never,
      `<template flowview={context} is:raw>
  <h1>{{ context.title }}</h1>
  <article>{{{ context.bodyHtml }}}</article>
</template>`,
      "/src/pages/raw.astro",
    );
    const astro =
      typeof result === "string"
        ? result
        : typeof result?.code === "string"
          ? result.code
          : "";
    const publicId = /from "(virtual:flowview-astro\/[^"]+)"/.exec(astro)?.[1];
    if (publicId === undefined) throw new Error("no virtual module import");

    const resolveId = plugin.resolveId as (id: string) => string | null;
    const load = plugin.load as (
      this: unknown,
      id: string,
    ) => Promise<string | { code: string; map: unknown }>;
    const module = await load.call({}, resolveId(publicId) ?? "");
    const moduleCode = typeof module === "string" ? module : module.code;

    expect(moduleCode).toContain("renderRawValue(context.bodyHtml)");
    const render = Function(
      "renderAttributeValue",
      "renderRawValue",
      "renderValue",
      `"use strict";\n${moduleCode
        .replace(/^import \{[^}]+\} from '[^']+';\n\n/, "")
        .replace("export function render", "function render")}\nreturn render;`,
    )(renderAttributeValue, renderRawValue, renderValue) as (
      context: Record<string, unknown>,
    ) => string;

    expect(
      render({ title: "<T>", bodyHtml: "<h2>Trusted</h2>" }).replace(
        /\s+/g,
        "",
      ),
    ).toBe("<h1>&lt;T&gt;</h1><article><h2>Trusted</h2></article>");
  });

  // @spec SPEC-HTML-086
  it("registers the flowview Vite plugin for standalone .flow imports", () => {
    let plugins: Plugin[] = [];
    const setup = flowview().hooks["astro:config:setup"] as ConfigSetupHook;
    setup({
      updateConfig(config) {
        plugins = config.vite?.plugins ?? [];
      },
    });

    expect(plugins.map((plugin) => plugin.name)).toEqual([
      "@flowview/vite",
      "@flowview/astro:embedded",
    ]);
  });

  // @spec SPEC-HTML-091
  it("preserves the Astro markup around an embedded template", async () => {
    const result = await transformAstro(`---
const context = { title: "Hello" };
---
<Layout title="Page">
  <header class="top"><a href="/">Home</a></header>
  <template flowview is:raw context={context}><h1>{{ context.title }}</h1></template>
  <footer>{new Date().getFullYear()}</footer>
</Layout>`);

    expect(result).toContain(
      '<Layout title="Page">\n  <header class="top"><a href="/">Home</a></header>\n  <Fragment set:html={__flowviewRender0(context)} />\n  <footer>{new Date().getFullYear()}</footer>\n</Layout>',
    );
    expect(result).not.toContain("<template flowview");
  });

  // @spec SPEC-HTML-093
  it("reports embedded diagnostics at their line in the host file", async () => {
    const plugin = createEmbeddedPlugin();
    const transformed = await transformAstroResult(
      `---\nconst context = {};\n---\n<main>\n<template flowview is:raw context={context}>\n<p>ok</p>\n@if () {\n<p>bad</p>\n}\n</template>\n</main>`,
      "/src/pages/broken.astro",
      plugin,
    );
    const publicId = /from "(virtual:flowview-astro\/[^"]+)"/.exec(
      transformed?.code ?? "",
    )?.[1];
    if (publicId === undefined) throw new Error("no virtual module import");
    const resolveId = plugin.resolveId as (id: string) => string | null;
    const load = plugin.load as (this: unknown, id: string) => Promise<unknown>;
    const resolved = resolveId(publicId);
    if (resolved === null) throw new Error("virtual module did not resolve");

    await expect(load.call({}, resolved)).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          filename: "/src/pages/broken.astro",
          line: 7,
          message: "Expression cannot be empty",
        }),
      ]),
    });
  });
});
