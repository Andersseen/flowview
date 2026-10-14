import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Layout from "./Layout.astro";

describe("Layout", () => {
  it("renders document chrome, SEO tags, accessibility hooks, and registers web components", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Layout, {
      props: {
        title: "flowview Test",
        description: "Unit test description",
        siteUrl: "https://test.example",
      },
      slots: {
        default: "<main><h1>Page content</h1></main>",
      },
    });

    expect(html).toContain("<title>flowview Test</title>");
    expect(html).toContain(
      'name="description" content="Unit test description"',
    );
    expect(html).toContain('property="og:title" content="flowview Test"');
    expect(html).toContain('rel="canonical" href="https://test.example/"');
    expect(html).toContain(
      'rel="icon" type="image/svg+xml" href="/favicon.svg"',
    );
    expect(html).toContain("Skip to content");
    expect(html).toContain('id="main-content"');
    expect(html).toContain("<and-navbar");
    expect(html).toContain('property="og:site_name" content="FlowView"');
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(html).not.toContain("summary_large_image");
    expect(html).not.toContain("flowview.example");
    expect(html).toContain("FlowView");
    expect(html).toContain("Getting started");
    expect(html).toContain("<footer");
    expect(html).toContain("Page content");
  });
});
