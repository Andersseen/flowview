import { describe, expect, it } from "vitest";
import { format } from "prettier";
import plugin from "./index.js";

async function formatAstro(source: string): Promise<string> {
  return format(source, {
    parser: "astro",
    plugins: [plugin],
  });
}

const TEMPLATE = `<template flowmark={context} is:raw>
  <ol class="grid gap-4" aria-label="Release history">
    @for (release of context.releases; track release.id) {
      <li>
        @switch (release.kind) {
          @case ('feature') { <b>Feature</b> }
          @default { <b>Docs</b> }
        }
        <h3>{{ release.title }}</h3>
      </li>
    } @empty {
      <li>No releases yet.</li>
    }
  </ol>
</template>`;

describe("@flowmark/prettier", () => {
  it("preserves flowmark template regions byte-for-byte", async () => {
    const source = `---
const context = { releases: [] };
---

${TEMPLATE}
`;

    const result = await formatAstro(source);
    expect(result).toContain(TEMPLATE);
  });

  it("still formats the rest of the Astro file", async () => {
    const source = `---
const   context = {title:"Hello"};
---
<p   class="intro"  >Before</p>
<template flowmark={context} is:raw>
  @if (context.title) { <h1>{{ context.title }}</h1> }
</template>
`;

    const result = await formatAstro(source);
    expect(result).toContain(`const context = { title: "Hello" };`);
    expect(result).toContain(`<p class="intro">Before</p>`);
    expect(result).toContain(
      `@if (context.title) { <h1>{{ context.title }}</h1> }`,
    );
  });

  it("is idempotent", async () => {
    const source = `---
const context = { title: "Hello" };
---

${TEMPLATE}
`;

    const once = await formatAstro(source);
    const twice = await formatAstro(once);
    expect(twice).toBe(once);
  });

  it("formats Astro files without flowmark templates like prettier-plugin-astro", async () => {
    const source = `<div   class="a" ><p>x</p></div>\n`;
    const result = await formatAstro(source);
    expect(result).toBe(`<div class="a"><p>x</p></div>\n`);
  });

  it("does not leak prettier-ignore state into the next file", async () => {
    // prettier-plugin-astro arms module-level state on `prettier-ignore`
    // comments; a Flowmark template right after one must consume it so the
    // next formatted file does not crash.
    const withIgnore = `<!-- prettier-ignore -->
<template flowmark={context} is:raw>
  @if (context.x) { <b>{{ context.y }}</b> }
</template>
`;

    const first = await formatAstro(withIgnore);
    expect(first).toContain("@if (context.x) { <b>{{ context.y }}</b> }");

    const second = await formatAstro(`<p   class="next-file">ok</p>\n`);
    expect(second).toBe(`<p class="next-file">ok</p>\n`);
  });

  it("preserves nested flowmark templates inside markup", async () => {
    const source = `<div>
  <template flowmark={context} is:raw>
    @for (item of context.items) { <span>{{ item }}</span> }
  </template>
</div>
`;

    const result = await formatAstro(source);
    expect(result).toContain(
      "@for (item of context.items) { <span>{{ item }}</span> }",
    );
  });
});
