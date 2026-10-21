import { expect, test } from "./fixtures";

// @spec SPEC-HTML-106 SPEC-HTML-107 SPEC-HTML-108
test("resolves current refs, conditional refs and sibling scopes in a browser", async ({
  page,
}) => {
  await page.goto("/e2e/view-composition");

  await expect(page.locator("#scope-result")).toHaveText(
    "2 first-view items; sibling Sibling",
  );
  await expect(page.locator("#conditional-result")).toHaveText(
    "search present",
  );
  await expect(page.locator("#child-result")).toHaveText(
    "isolated; Child before parent replacement",
  );

  await page.locator("#change").click();
  await expect(page.locator("#scope-result")).toHaveText(
    "1 first-view items; sibling Sibling",
  );
  await expect(page.locator("#conditional-result")).toHaveText("search absent");

  await page.locator("#change").click();
  await expect(page.locator("#conditional-result")).toHaveText(
    "search present",
  );
  await expect(page.locator("#scope-result")).toHaveText(
    "1 first-view items; sibling Sibling",
  );
});

// @spec SPEC-HTML-111 SPEC-HTML-112
test("stops and rebinds a synchronous source in the browser", async ({
  page,
}) => {
  await page.goto("/e2e/view-composition");
  const summary = page.locator("#view-one [data-flow-ref=summary]");
  await expect(summary).toHaveText("2 items");

  await page.locator("#stop").click();
  await page.locator("#change").click();
  await expect(summary).toHaveText("2 items");

  await page.locator("#rebind").click();
  await expect(summary).toHaveText("1 items");
  await page.locator("#change").click();
  await expect(summary).toHaveText("1 items");
  await expect(page.locator("#conditional-result")).toHaveText(
    "search present",
  );
});

// @spec SPEC-HTML-113
test("dispose stops updates while leaving the current rendered DOM in place", async ({
  page,
}) => {
  await page.goto("/e2e/view-composition");
  await page.locator("#dispose").click();
  await page.locator("#change").click();

  await expect(page.locator("#view-one [data-flow-ref=summary]")).toHaveText(
    "2 items",
  );
  await expect(page.locator("[data-flow-ref=search]")).toHaveCount(1);
});

// @spec SPEC-HTML-109 SPEC-HTML-114
test("parent replacement disposes a nested view and stops its binding", async ({
  page,
}) => {
  await page.goto("/e2e/view-composition");
  await page.locator("#replace-parent").click();

  await expect(page.locator("#child-result")).toHaveText("child disposed");
  await expect(page.locator("#detached-child")).toHaveText(
    "Child before parent replacement",
  );
  await page.locator("#change-child").click();
  await expect(page.locator("#detached-child")).toHaveText(
    "Child before parent replacement",
  );
});
