import { expect, test } from "@playwright/test";

// Phase 4 hardening for flowview Events v2 (delegated runtime + scopes).
// Each test targets a specific defect the v1 architecture had.

test("routes colliding handler names to the right component scope", async ({
  page,
}) => {
  // Two components on one page both declare `save()`. A single global handler
  // map (the v1 defect) would let one registration clobber the other.
  await page.goto("/e2e/scopes");

  const outA = page.getByTestId("out-a");
  const outB = page.getByTestId("out-b");
  await expect(outA).toHaveText("idle");
  await expect(outB).toHaveText("idle");

  await page.getByTestId("save-a").click();
  await expect(outA).toHaveText("A");
  await expect(outB).toHaveText("idle"); // B's handler must not have fired

  await page.getByTestId("save-b").click();
  await expect(outB).toHaveText("B");
  await expect(outA).toHaveText("A"); // A's output must be untouched
});

test("keeps handlers working across view-transition navigation", async ({
  page,
}) => {
  await page.goto("/e2e/vt-one");

  await page.getByTestId("ping-one").click();
  await expect(page.getByTestId("out-one")).toHaveText("one-pinged");

  // Count soft navigations and prove the JS realm persists: a full reload
  // would wipe both this counter and the document-level delegated listener.
  await page.evaluate(() => {
    (window as unknown as { __loads: number }).__loads = 0;
    (window as unknown as { __soft: string }).__soft = "kept";
    document.addEventListener("astro:page-load", () => {
      (window as unknown as { __loads: number }).__loads += 1;
    });
  });

  await page.getByTestId("to-two").click();
  await page.waitForFunction(
    () => (window as unknown as { __loads: number }).__loads >= 1,
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __soft?: string }).__soft,
    ),
  ).toBe("kept");

  await page.getByTestId("ping-two").click();
  await expect(page.getByTestId("out-two")).toHaveText("two-pinged");

  await page.getByTestId("to-one").click();
  await page.waitForFunction(
    () => (window as unknown as { __loads: number }).__loads >= 2,
  );

  // Back on the first page: its script already ran, but the delegated
  // listener and the scope registry survived the navigation.
  await page.getByTestId("ping-one").click();
  await expect(page.getByTestId("out-one")).toHaveText("one-pinged");
});

test("fires on elements added to the DOM after load", async ({ page }) => {
  await page.goto("/e2e/dynamic");

  const rows = page.getByTestId("rows").locator("li");
  await expect(rows).toHaveCount(0);

  await page.getByTestId("add-row").click();
  await page.getByTestId("add-row").click();
  await expect(rows).toHaveCount(2);

  // The remove button did not exist at page load; delegation must still catch
  // its click.
  await rows.first().getByRole("button", { name: "remove" }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("removed-count")).toHaveText("1");
});

test("delegates input (bubble) and focus (capture) events", async ({
  page,
}) => {
  await page.goto("/e2e/dynamic");

  await page.getByTestId("text-input").fill("hello");
  await expect(page.getByTestId("input-value")).toHaveText("hello");

  await page.getByTestId("focus-input").focus();
  await expect(page.getByTestId("focus-state")).toHaveText("focused");
});
