import { expect, test } from "@playwright/test";

test("renders the Flowmark landing page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Flowmark", level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .locator("header")
      .getByText("HTML-like templates with modern control flow"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Why Flowmark?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Modern control flow" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Familiar syntax" }),
  ).toBeVisible();
  await expect(
    page.getByText("@for (product of products; track product.id)"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Real-world example" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Get started" }),
  ).toBeVisible();
  await expect(
    page.getByText("npm install @flowmark/astro @flowmark/runtime"),
  ).toBeVisible();
  await expect(page.locator("footer")).toContainText("Flowmark");
});

test("preserves whitespace and escapes interpolated HTML", async ({ page }) => {
  await page.goto("/security");

  await expect(page.locator("#space")).toHaveText("Hello Flowmark");
  await expect(page.locator("#pre")).toHaveText("first\n  second");
  await expect(page.locator("#escaped")).toHaveText(
    '<img src=x onerror="globalThis.__flowmarkXss = true">',
  );
  await expect(page.locator("#escaped img")).toHaveCount(0);
  await expect(page.locator("#literal-at")).toHaveText("contact@if.example");
  await expect(page.locator("#literal-at")).toHaveAttribute(
    "title",
    "@if inside an attribute is literal",
  );
  expect(
    await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { __flowmarkXss?: boolean })
          .__flowmarkXss,
    ),
  ).toBeUndefined();
});

test("renders an isolated inline Flowmark page in Astro", async ({ page }) => {
  await page.goto("/inline");
  await expect(page.locator("#inline")).toHaveText(
    "Hello from an inline Astro template",
  );
});
