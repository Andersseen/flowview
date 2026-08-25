import { expect, test } from "@playwright/test";

test("updates a compiled Flowview DOM view and keeps events delegated", async ({
  page,
}) => {
  await page.goto("/client-dom");

  await expect(page.getByTestId("client-empty")).toHaveText("No tasks yet.");
  await expect(page.getByTestId("summary")).toHaveText("0 tasks");

  await expect(page.getByText("Draft report")).toBeVisible();
  await expect(page.getByTestId("summary")).toHaveText("2 tasks");

  await expect(page.getByText("Publish metrics")).toBeVisible();
  await expect(page.getByText("Draft report")).toHaveCount(0);

  const updatedRows = page.getByTestId("client-item");
  await expect(updatedRows).toHaveCount(2);
  await updatedRows.first().getByRole("button", { name: "Select" }).click();
  await expect(page.getByTestId("selected-task")).toHaveText("Selected task 3");
});
