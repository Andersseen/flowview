import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import CodeBlock from "./CodeBlock.astro";

describe("CodeBlock", () => {
  it("renders a titled code panel with the requested language", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(CodeBlock, {
      props: {
        title: "src/components/Inventory.astro",
        language: "astro + flowmark",
      },
      slots: {
        default: "<main>{{ ctx.title }}</main>",
      },
    });

    expect(html).toContain("<and-card");
    expect(html).toContain("src/components/Inventory.astro");
    expect(html).toContain("astro + flowmark");
    expect(html).toContain("<main>{{ ctx.title }}</main>");
  });
});
