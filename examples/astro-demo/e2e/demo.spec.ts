import { expect, test } from "@playwright/test";

test("renders the main Flowmark demo", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Inventory Dashboard" }),
  ).toBeVisible();

  const preview = page.locator(".flow-preview").first();
  await expect(preview.getByText("Ergonomic Keyboard")).toBeVisible();
  await expect(preview.getByText("In stock").first()).toBeVisible();
  await expect(page.getByText("Product inventory")).toBeVisible();
});

test("renders the @empty branch page", async ({ page }) => {
  await page.goto("/empty");

  await expect(
    page.getByRole("heading", { name: "Empty State" }),
  ).toBeVisible();
  await expect(
    page.locator(".flow-preview").getByText("No products found."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The same inline Flowmark template renders the fallback branch when context.products is empty.",
    ),
  ).toBeVisible();
});

test("renders @else if and nested stock-health branches", async ({ page }) => {
  await page.goto("/attention");

  await expect(
    page.getByRole("heading", { name: "Inventory Attention" }),
  ).toBeVisible();
  await expect(page.getByText("Low · 4")).toBeVisible();
  await expect(page.getByText("None")).toBeVisible();
  await expect(page.getByText("View full inventory")).toBeVisible();
  await expect(page.getByText("Ergonomic Keyboard")).toHaveCount(0);
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
