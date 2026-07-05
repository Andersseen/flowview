import { expect, test } from "@playwright/test";

test("renders the flowview landing page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Angular-style template DX, without Angular.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Control flow compiler" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Events compiler" }),
  ).toBeVisible();
});

test("renders the flowview control flow page", async ({ page }) => {
  await page.goto("/control-flow");

  await expect(
    page.getByRole("heading", { name: "flowview", level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .locator("header")
      .getByText("HTML-like templates with modern control flow"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Why flowview?" }),
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
    page.getByText("npm install @flowview/astro @flowview/runtime"),
  ).toBeVisible();
  await expect(page.locator("footer")).toContainText("flowview");
});

test("runs compiled event handlers", async ({ page }) => {
  await page.goto("/events");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#event-output")).toHaveText(
    "Saved from a click event",
  );

  await page.getByRole("button", { name: "Remove item 1" }).click();
  await expect(page.locator("#event-output")).toHaveText(
    "Removed item-1 with a serialized argument",
  );
  await expect(page.getByRole("button", { name: "Removed" })).toBeDisabled();
});

test("preserves whitespace and escapes interpolated HTML", async ({ page }) => {
  await page.goto("/security");

  await expect(page.locator("#space")).toHaveText("Hello flowview");
  await expect(page.locator("#pre")).toHaveText("first\n  second");
  await expect(page.locator("#escaped")).toHaveText(
    '<img src=x onerror="globalThis.__flowviewXss = true">',
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
        (globalThis as typeof globalThis & { __flowviewXss?: boolean })
          .__flowviewXss,
    ),
  ).toBeUndefined();
});

test("renders an isolated inline flowview page in Astro", async ({ page }) => {
  await page.goto("/inline");
  await expect(page.locator("#inline")).toHaveText(
    "Hello from an inline Astro template",
  );
});
