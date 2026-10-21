import { expect, test } from "./fixtures";

// @spec SPEC-HTML-115
test("updates a compiled Flowview DOM view and keeps events delegated", async ({
  page,
}) => {
  await page.goto("/client-dom");

  await expect(page.getByTestId("reload")).toBeEnabled();
  await expect(page.getByTestId("client-items-list")).toHaveAttribute(
    "aria-busy",
    "false",
  );

  await expect(page.getByText("Draft report")).toBeVisible();
  await expect(page.getByTestId("summary")).toHaveText("2 tasks");
  await expect(page.getByTestId("reload")).toBeEnabled();
  await expect(page.getByTestId("selected-task")).toHaveText(
    "No task selected",
  );

  await page.getByTestId("reload").click();
  await expect(page.getByTestId("reload")).toBeDisabled();
  await expect(page.getByTestId("client-items-list")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.getByTestId("reload")).toHaveClass(/loading/);

  await expect(page.getByText("Publish metrics")).toBeVisible();
  await expect(page.getByText("Draft report")).toHaveCount(0);

  const updatedRows = page.getByTestId("client-item");
  await expect(updatedRows).toHaveCount(2);

  // Integration proof for @flowview/reactive and @flowview/dom: the Flowview
  // Event handler only writes to `clientState`; `view.bind(clientState)` in
  // client-dom.astro renders that synchronous change into replacement DOM.
  await updatedRows.first().getByRole("button", { name: "Select" }).click();
  await expect(page.getByTestId("selected-task")).toHaveText("Selected task 3");
});
