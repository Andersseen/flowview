import { expect, test } from "./fixtures";

test.describe("capabilities page", () => {
  test("is reachable from the landing page and navigation", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Capabilities" }).first().click();
    await expect(page).toHaveURL(/\/capabilities\/?$/);
    await expect(
      page.getByRole("heading", { name: "What FlowView does today", level: 1 }),
    ).toBeVisible();
  });

  test("renders the inventory from typed data through FlowView", async ({
    page,
  }) => {
    await page.goto("/capabilities");

    const groups = page.getByTestId("capability-group");
    await expect(groups).toHaveCount(5);
    await expect(
      page.getByRole("heading", { name: "Template compiler", level: 3 }),
    ).toBeVisible();

    const staticRender = page.locator('[data-capability="static"]');
    await expect(staticRender).toContainText("Compiler/spec");
    // Native static rendering is not browser evidence and must not claim it.
    await expect(staticRender).not.toContainText("Browser E2E");
    await expect(staticRender).not.toContainText("Live demo");

    const events = page.locator('[data-capability="click-input"]');
    await expect(events).toContainText("Browser E2E");
    await events.getByRole("link").click();
    await expect(page).toHaveURL(/\/events\/?$/);
  });
});

test.describe("interpolation", () => {
  test("escaped text stays text and raw trusted HTML becomes markup", async ({
    page,
  }) => {
    await page.goto("/capabilities");

    const escaped = page.getByTestId("interp-escaped");
    await expect(escaped).toHaveText("<strong>Hello</strong>");
    await expect(escaped.locator("strong")).toHaveCount(0);

    const raw = page.getByTestId("interp-raw");
    await expect(raw.locator("strong")).toHaveText("Hello");
    await expect(raw).toHaveText("Hello");
  });

  test("escaped hostile values are inert", async ({ page }) => {
    await page.goto("/capabilities");

    const hostile = page.getByTestId("interp-hostile");
    await expect(hostile).toContainText("<img src=x onerror=");
    await expect(hostile.locator("img")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __flowviewCapabilitiesXss?: boolean;
            }
          ).__flowviewCapabilitiesXss,
      ),
    ).toBeUndefined();
  });
});

test.describe("@switch", () => {
  test("renders known cases and the default", async ({ page }) => {
    await page.goto("/capabilities");

    const result = (status: string) =>
      page
        .locator(`[data-testid="switch-row"][data-status="${status}"]`)
        .getByTestId("switch-result");

    await expect(result("draft")).toHaveText("Draft");
    await expect(result("published")).toHaveText("Published");
    await expect(result("archived")).toHaveText("Unknown status");
    await expect(result("something-else")).toHaveText("Unknown status");
  });
});

test.describe("Unicode and literal markers", () => {
  test("keeps multi-byte text intact and marker text literal", async ({
    page,
  }) => {
    await page.goto("/capabilities");

    await expect(page.getByTestId("unicode-samples").locator("li")).toHaveText([
      "é",
      "€",
      "🙂",
      "�",
      "@if",
      "{{ value }}",
      "{{{ value }}}",
    ]);
    await expect(page.getByTestId("unicode-literal")).toHaveText(
      "é € 🙂 � contact@if.example",
    );
    await expect(page.getByTestId("unicode-escaped")).toHaveText(
      "@if {{ value }} {{{ value }}} 🙂 }",
    );
  });
});

test.describe("client DOM composition (standalone .flow)", () => {
  test("applies bindings on both sides of a state transition", async ({
    page,
  }) => {
    await page.goto("/client-dom?manual");

    const reload = page.getByTestId("reload");
    const list = page.getByTestId("client-items-list");

    await expect(reload).toBeEnabled();
    await expect(reload).not.toHaveClass(/loading/);
    await expect(list).toHaveAttribute("aria-busy", "false");

    await reload.click();
    await expect(reload).toBeDisabled();
    await expect(reload).toHaveClass(/loading/);
    await expect(list).toHaveAttribute("aria-busy", "true");

    await expect(reload).toBeEnabled();
    await expect(reload).not.toHaveClass(/loading/);
    await expect(list).toHaveAttribute("aria-busy", "false");

    // [class.active] follows the selection.
    const rows = page.getByTestId("client-item");
    await rows.nth(1).getByRole("button", { name: "Select" }).click();
    await expect(rows.nth(1)).toHaveClass(/active/);
    await expect(rows.nth(0)).not.toHaveClass(/active/);
    await rows.nth(0).getByRole("button", { name: "Select" }).click();
    await expect(rows.nth(0)).toHaveClass(/active/);
    await expect(rows.nth(1)).not.toHaveClass(/active/);
  });

  test("moves empty → items → empty with delegated events intact", async ({
    page,
  }) => {
    await page.goto("/client-dom?manual");

    const empty = page.getByTestId("client-empty");
    const rows = page.getByTestId("client-item");
    const selected = page.getByTestId("selected-task");

    await expect(empty).toBeVisible();
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("summary")).toHaveText("0 tasks");

    // Items arrive: the DOM is replaced and no listeners are rebound.
    await page.getByTestId("reload").click();
    await expect(rows).toHaveCount(2);
    await expect(empty).toHaveCount(0);
    await rows.first().getByRole("button", { name: "Select" }).click();
    await expect(selected).toHaveText("Selected task 3");

    // Everything removed: @empty renders again.
    await page.getByTestId("clear").click();
    await expect(empty).toBeVisible();
    await expect(rows).toHaveCount(0);
    await expect(selected).toHaveText("No task selected");

    // And back, with item events working on the newest DOM.
    await expect(page.getByTestId("reload")).toBeEnabled();
    await page.getByTestId("reload").click();
    await expect(rows).toHaveCount(2);
    await rows.nth(1).getByRole("button", { name: "Select" }).click();
    await expect(selected).toHaveText("Selected task 4");
  });
});

test.describe("embedded Astro authoring", () => {
  test("renders an inline template", async ({ page }) => {
    await page.goto("/inline");
    await expect(page.locator("#inline")).toHaveText(
      "Hello from an inline Astro template",
    );
  });
});
