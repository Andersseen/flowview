import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Layout from "./Layout.astro";

describe("Layout", () => {
  it("renders document chrome, SEO tags, accessibility hooks, and registers web components", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Layout, {
      props: {
        title: "Flowmark Test",
        description: "Unit test description",
        siteUrl: "https://test.example",
      },
      slots: {
        default: "<main><h1>Page content</h1></main>",
      },
    });

    expect(html).toContain("<title>Flowmark Test</title>");
    expect(html).toContain(
      'name="description" content="Unit test description"',
    );
    expect(html).toContain('property="og:title" content="Flowmark Test"');
    expect(html).toContain('rel="canonical" href="https://test.example/"');
    expect(html).toContain(
      'rel="icon" type="image/svg+xml" href="/favicon.svg"',
    );
    expect(html).toContain("Skip to content");
    expect(html).toContain('id="main-content"');
    expect(html).toContain("<and-navbar");
    expect(html).toContain("Flowmark");
    expect(html).toContain("Page content");
  });
});
