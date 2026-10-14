import { expect, test } from "./fixtures";

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
