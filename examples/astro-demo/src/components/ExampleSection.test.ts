import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import ExampleSection from "./ExampleSection.astro";

describe("ExampleSection", () => {
  it("renders a changelog-style example list", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ExampleSection, {
      props: {
        context: {
          title: "Real-world example",
          description: "A changelog rendered with Flowmark.",
          releases: [
            {
              id: "v1",
              version: "1.0.0",
              date: "2026-01-01",
              title: "Initial release",
              summary: "First stable release.",
              kind: "feature",
            },
            {
              id: "v2",
              version: "1.0.1",
              date: "2026-01-02",
              title: "Bug fix",
              summary: "Fixed a small issue.",
              kind: "fix",
              breaking: true,
            },
          ],
        },
      },
    });

    expect(html).toContain("Real-world example");
    expect(html).toContain("A changelog rendered with Flowmark.");
    expect(html).toContain("Initial release");
    expect(html).toContain("v1.0.0");
    expect(html).toContain("Feature");
    expect(html).toContain("Fix");
    expect(html).toContain("Breaking");
  });

  it("renders the empty fallback when no releases are provided", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ExampleSection, {
      props: {
        context: {
          title: "Real-world example",
          description: "A changelog rendered with Flowmark.",
          releases: [],
        },
      },
    });

    expect(html).toContain("No releases yet.");
  });
});
