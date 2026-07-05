import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Footer from "./Footer.astro";

describe("Footer", () => {
  it("renders brand, links, and copyright", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Footer, {
      props: {
        context: {
          brand: "flowview",
          tagline: "HTML-like templates with modern control flow.",
          links: [
            {
              label: "GitHub",
              href: "https://github.com/andersseen/flowview",
              external: true,
            },
            { label: "Home", href: "/" },
          ],
          copyright: "© 2024 flowview.",
        },
      },
    });

    expect(html).toContain("flowview");
    expect(html).toContain("HTML-like templates with modern control flow.");
    expect(html).toContain("GitHub");
    expect(html).toContain("https://github.com/andersseen/flowview");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Home");
    expect(html).toContain('href="/"');
    expect(html).toContain("© 2024 flowview.");
  });
});
