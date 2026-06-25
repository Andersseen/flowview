import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Hero from "./Hero.astro";

describe("Hero", () => {
  it("renders title, tagline, and CTAs", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Hero, {
      props: {
        context: {
          title: "Flowmark",
          tagline: "HTML-like templates with modern control flow.",
          ctaPrimary: { text: "Get started", href: "#getting-started" },
          ctaSecondary: { text: "View on GitHub", href: "https://github.com" },
        },
      },
    });

    expect(html).toContain("Flowmark");
    expect(html).toContain("HTML-like templates with modern control flow.");
    expect(html).toContain("Get started");
    expect(html).toContain('#getting-started"');
    expect(html).toContain("View on GitHub");
    expect(html).toContain("https://github.com");
  });

  it("skips secondary CTA when not provided", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Hero, {
      props: {
        context: {
          title: "Flowmark",
          tagline: "Test tagline",
          ctaPrimary: { text: "Primary", href: "#primary" },
        },
      },
    });

    expect(html).toContain("Primary");
    expect(html).not.toContain("View on GitHub");
  });
});
