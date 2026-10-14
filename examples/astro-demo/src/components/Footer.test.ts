import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Footer from "./Footer.astro";

describe("Footer", () => {
  it("renders brand, grouped links and the implementation note", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Footer, {
      props: {
        context: {
          brand: "FlowView",
          tagline: "A small template compiler for HTML.",
          columns: [
            {
              title: "Learn",
              links: [{ label: "Getting started", href: "/getting-started" }],
            },
            {
              title: "Community",
              links: [
                {
                  label: "GitHub",
                  href: "https://github.com/andersseen/flowview",
                  external: true,
                },
              ],
            },
          ],
          note: "© 2024 FlowView.",
        },
      },
    });

    expect(html).toContain("FlowView");
    expect(html).toContain("A small template compiler for HTML.");
    expect(html).toContain("Learn");
    expect(html).toContain('href="/getting-started"');
    expect(html).toContain("https://github.com/andersseen/flowview");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("© 2024 FlowView.");
  });
});
