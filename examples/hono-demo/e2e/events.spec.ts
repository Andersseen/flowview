import { expect, test } from "@playwright/test";

test("renders the server-side @for list", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Buy milk")).toBeVisible();
  await expect(page.getByText("Ship flowview")).toBeVisible();
});

test("fires the compiled click handler", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#click-output")).toHaveText(
    "Saved from a click event",
  );
});

test("fires the compiled input handler", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Type to trigger (input)").fill("hello");
  await expect(page.locator("#input-output")).toHaveText("hello");
});

test("delegates clicks to rows added to the DOM after load", async ({
  page,
}) => {
  await page.goto("/");
  const rows = page.locator("#rows li");
  await expect(rows).toHaveCount(0);

  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByRole("button", { name: "Add row" }).click();
  await expect(rows).toHaveCount(2);

  // These "Remove" buttons did not exist at page load; the delegated
  // document-level listener must still catch their click.
  await rows.first().getByRole("button", { name: "Remove" }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.locator("#removed-count")).toHaveText("1");
});
