import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import GettingStarted from "./GettingStarted.astro";

describe("GettingStarted", () => {
  it("renders steps with code blocks and language badges", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(GettingStarted, {
      props: {
        context: {
          title: "Get started",
          description: "Add flowview to your project.",
          steps: [
            {
              label: "Install",
              code: "npm install @flowview/astro",
              description: "Install the package.",
            },
            {
              label: "Configure",
              code: "integrations: [flowview()]",
              description: "Add the integration.",
            },
          ],
        },
      },
    });

    expect(html).toContain("Get started");
    expect(html).toContain("Add flowview to your project.");
    expect(html).toContain("Install");
    expect(html).toContain("npm install @flowview/astro");
    expect(html).toContain("Configure");
    expect(html).toContain("integrations: [flowview()]");
    expect(html).toContain("bash");
    expect(html).toContain("astro");
  });
});
