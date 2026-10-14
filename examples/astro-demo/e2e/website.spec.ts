import { expect, test } from "./fixtures";

const PRODUCTION_ORIGIN = "https://flowview-demo.pages.dev";

test.describe("public product surface", () => {
  test("home page states the product and leads with Getting started", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "without a framework",
    );

    const primary = page
      .getByRole("main")
      .getByRole("link", { name: "Get started" })
      .first();
    await expect(primary).toBeVisible();
    await primary.click();
    await expect(page).toHaveURL(/\/getting-started\/?$/);
  });

  test("home page covers every major product section", async ({ page }) => {
    await page.goto("/");

    for (const name of [
      /one template language/i,
      /one parser, two render targets/i,
      /native events/i,
      /small packages/i,
      /boring when it breaks/i,
      /deliberately is not/i,
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
  });

  test("hero example is rendered by FlowView and its event works", async ({
    page,
  }) => {
    await page.goto("/");

    const rows = page.getByTestId("hero-live").locator("li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveClass(/active/);
    await rows.nth(1).getByRole("button", { name: "Select" }).click();
    await expect(rows.nth(1)).toHaveClass(/active/);
    await expect(rows.nth(0)).not.toHaveClass(/active/);
  });

  test("navigation reaches Getting started, Packages and Capabilities", async ({
    page,
  }) => {
    for (const [name, url] of [
      ["Getting started", /\/getting-started\/?$/],
      ["Packages", /\/packages\/?$/],
      ["Capabilities", /\/capabilities\/?$/],
    ] as const) {
      await page.goto("/");
      await page
        .getByRole("menubar", { name: "FlowView navigation" })
        .getByRole("menuitem", { name })
        .click();
      await expect(page).toHaveURL(url);
    }
  });

  test("GitHub link points at the repository", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "FlowView on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/andersseen/flowview");
  });

  test("metadata uses the real production origin and consistent social tags", async ({
    page,
  }) => {
    for (const path of ["/", "/packages", "/getting-started"]) {
      await page.goto(path);
      const canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute("href");
      expect(canonical?.replace(/(?<=.)\/$/, "")).toBe(
        `${PRODUCTION_ORIGIN}${path === "/" ? "" : path}`.replace(
          /(?<=.)\/$/,
          "",
        ),
      );
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content",
        canonical!,
      );
      await expect(
        page.locator('meta[property="og:site_name"]'),
      ).toHaveAttribute("content", "FlowView");
      // No large social image is published, so the card must not claim one.
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        "content",
        "summary",
      );
      expect(await page.content()).not.toContain("flowview.example");
    }
  });

  test("product navigation never exposes internal /e2e fixtures", async ({
    page,
  }) => {
    for (const path of [
      "/",
      "/getting-started",
      "/packages",
      "/control-flow",
      "/events",
      "/client-dom",
      "/capabilities",
      "/security",
    ]) {
      await page.goto(path);
      const hrefs = await page
        .locator("a[href]")
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute("href") ?? ""),
        );
      expect(
        hrefs.filter((href) => href.includes("/e2e/")),
        `${path} links to an internal fixture`,
      ).toEqual([]);
    }
  });
});

test.describe("packages page", () => {
  test("lists only installable npm packages with an install command", async ({
    page,
  }) => {
    await page.goto("/packages");

    for (const id of [
      "flowview-compiler",
      "compiler",
      "runtime",
      "vite",
      "astro",
      "events",
      "vite-events",
      "astro-events",
      "dom",
      "reactive",
      "prettier",
    ]) {
      await expect(page.locator(`[data-package="${id}"]`)).toHaveCount(1);
    }

    // The Rust crate is not on crates.io, so no crates.io-style install.
    const crate = page.locator('[data-package="flowview-compiler"]');
    await expect(crate).toContainText("--git");
    await expect(crate).not.toContainText("cargo add flowview-compiler");

    // Packages that are not published must not show an npm install command.
    for (const id of ["vscode", "cli"]) {
      await expect(page.locator(`[data-package="${id}"]`)).not.toContainText(
        "npm install",
      );
    }
  });

  test("recipes name the real direct dependencies", async ({ page }) => {
    await page.goto("/packages");
    await expect(page.locator('[data-recipe="astro-events"]')).toContainText(
      "@flowview/astro-events @flowview/events @flowview/vite-events",
    );
  });
});

test.describe("getting started", () => {
  test("covers Astro, Vite/Hono, browser DOM and native Rust", async ({
    page,
  }) => {
    await page.goto("/getting-started");

    for (const name of [
      "Astro",
      "Vite, Hono, Node.js and Workers",
      "Browser DOM",
      "Native Rust static rendering",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(
      page.getByText("npm install @flowview/astro @flowview/runtime"),
    ).toBeVisible();
    await expect(page.locator("#rust")).toContainText("not yet published");
  });
});

test.describe("syntax and events pages", () => {
  test("syntax page documents the full language", async ({ page }) => {
    await page.goto("/control-flow");

    for (const name of [
      /context object/i,
      /interpolation/i,
      /@if, @else if, @else/,
      /@for, track, @empty/,
      /@switch, @case, @default/,
      /bindings/i,
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
  });

  test("events page runs input, change and submit handlers", async ({
    page,
  }) => {
    await page.goto("/events");
    const output = page.locator("#event-output");

    await page.locator("#event-demo-select").selectOption("team");
    await expect(output).toHaveText("Change event value: team");

    await page.locator("#event-demo-form input").fill("a@b.co");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(output).toHaveText("Submit event handled without a page load");
    await expect(page).toHaveURL(/\/events\/?$/);
  });
});
