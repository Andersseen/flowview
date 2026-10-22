import { expect, test } from "./fixtures";

// @spec SPEC-HTML-118 SPEC-HTML-119 SPEC-HTML-120 SPEC-HTML-121
test("native control defaults, live edits, scoped refs and reset use browser semantics", async ({
  page,
}) => {
  await page.goto("/e2e/forms");

  const form = page.locator("#forms-root form");
  const name = page.locator('#forms-root [data-flow-ref="name"]');
  const notes = page.locator('#forms-root [data-flow-ref="notes"]');
  const enabled = page.locator('#forms-root [data-flow-ref="enabled"]');
  const locked = page.locator('#forms-root [data-flow-ref="locked"]');
  const region = page.locator('#forms-root [data-flow-ref="region"]');
  const topics = page.locator('#forms-root [data-flow-ref="topics"]');
  const details = page.locator('#forms-root [data-flow-ref="details"]');
  const selectedTopics = () =>
    topics.evaluate((element) =>
      Array.from(
        (element as HTMLSelectElement).selectedOptions,
        (option) => option.value,
      ),
    );

  await expect(name).toHaveValue("Ada");
  await expect(notes).toHaveValue("First note\nSecond note");
  await expect(enabled).toBeChecked();
  await expect(name).toHaveAttribute("required", "");
  await expect(locked).toBeDisabled();
  await expect(form.locator('[name="plan"][value="pro"]')).toBeChecked();
  await expect(region).toHaveValue("south");
  expect(await selectedTopics()).toEqual(["blue"]);
  await expect(details).toHaveAttribute("open", "");

  const initial = await page.evaluate(() => {
    const nameInput = document.querySelector<HTMLInputElement>(
      '#forms-root [data-flow-ref="name"]',
    );
    const noteArea = document.querySelector<HTMLTextAreaElement>(
      '#forms-root [data-flow-ref="notes"]',
    );
    const checkbox = document.querySelector<HTMLInputElement>(
      '#forms-root [data-flow-ref="enabled"]',
    );
    const requiredInput = document.querySelector<HTMLInputElement>(
      '#forms-root [data-flow-ref="name"]',
    );
    const disabledInput = document.querySelector<HTMLInputElement>(
      '#forms-root [data-flow-ref="locked"]',
    );
    const select = document.querySelector<HTMLSelectElement>(
      '#forms-root [data-flow-ref="region"]',
    );
    const detailsElement = document.querySelector<HTMLDetailsElement>(
      '#forms-root [data-flow-ref="details"]',
    );
    const multipleSelect = document.querySelector<HTMLSelectElement>(
      '#forms-root [data-flow-ref="topics"]',
    );
    return {
      nameAttribute: nameInput?.getAttribute("value"),
      nameDefault: nameInput?.defaultValue,
      nameProperty: nameInput?.value,
      textareaValueAttribute: noteArea?.getAttribute("value"),
      textareaDefault: noteArea?.defaultValue,
      textareaProperty: noteArea?.value,
      checkboxAttribute: checkbox?.getAttribute("checked"),
      checkboxDefault: checkbox?.defaultChecked,
      checkboxProperty: checkbox?.checked,
      requiredAttribute: requiredInput?.getAttribute("required"),
      requiredProperty: requiredInput?.required,
      disabledAttribute: disabledInput?.getAttribute("disabled"),
      disabledProperty: disabledInput?.disabled,
      regionOptions: Array.from(select?.options ?? []).map((option) => ({
        selectedAttribute: option.getAttribute("selected"),
        defaultSelected: option.defaultSelected,
        selected: option.selected,
      })),
      detailsAttribute: detailsElement?.getAttribute("open"),
      detailsProperty: detailsElement?.open,
      multipleAttribute: multipleSelect?.getAttribute("multiple"),
      multipleProperty: multipleSelect?.multiple,
      topicDefaults: Array.from(multipleSelect?.options ?? []).map(
        (option) => ({
          defaultSelected: option.defaultSelected,
          selected: option.selected,
        }),
      ),
    };
  });
  expect(initial).toEqual({
    nameAttribute: "Ada",
    nameDefault: "Ada",
    nameProperty: "Ada",
    textareaValueAttribute: null,
    textareaDefault: "First note\nSecond note",
    textareaProperty: "First note\nSecond note",
    checkboxAttribute: "",
    checkboxDefault: true,
    checkboxProperty: true,
    requiredAttribute: "",
    requiredProperty: true,
    disabledAttribute: "",
    disabledProperty: true,
    regionOptions: [
      { selectedAttribute: null, defaultSelected: false, selected: false },
      { selectedAttribute: "", defaultSelected: true, selected: true },
    ],
    detailsAttribute: "",
    detailsProperty: true,
    multipleAttribute: "",
    multipleProperty: true,
    topicDefaults: [
      { defaultSelected: false, selected: false },
      { defaultSelected: true, selected: true },
      { defaultSelected: false, selected: false },
    ],
  });

  await name.fill("Grace");
  await notes.fill("Local draft");
  await expect(name).toHaveValue("Grace");
  await expect(page.locator("#event-log")).toContainText(
    "input:name:Grace:true",
  );
  const dirty = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      '#forms-root [data-flow-ref="name"]',
    );
    const area = document.querySelector<HTMLTextAreaElement>(
      '#forms-root [data-flow-ref="notes"]',
    );
    return {
      valueAttribute: input?.getAttribute("value"),
      value: input?.value,
      defaultValue: input?.defaultValue,
      textareaText: area?.textContent,
      textareaValue: area?.value,
      textareaDefaultValue: area?.defaultValue,
    };
  });
  expect(dirty).toEqual({
    valueAttribute: "Ada",
    value: "Grace",
    defaultValue: "Ada",
    textareaText: "First note\nSecond note",
    textareaValue: "Local draft",
    textareaDefaultValue: "First note\nSecond note",
  });

  await enabled.uncheck();
  await form.locator('[name="plan"][value="basic"]').check();
  await region.selectOption("north");
  await topics.selectOption(["red", "green"]);
  await details.locator("summary").click();
  await expect(details).not.toHaveAttribute("open");
  await expect(page.locator("#event-log")).toContainText(
    "change:region:north:true",
  );
  await expect(page.locator("#event-log")).toContainText("toggle");
  const dirtyNative = await page.evaluate(() => {
    const checkbox = document.querySelector<HTMLInputElement>(
      '#forms-root [data-flow-ref="enabled"]',
    );
    const select = document.querySelector<HTMLSelectElement>(
      '#forms-root [data-flow-ref="region"]',
    );
    const detailsElement = document.querySelector<HTMLDetailsElement>(
      '#forms-root [data-flow-ref="details"]',
    );
    const topicsSelect = document.querySelector<HTMLSelectElement>(
      '#forms-root [data-flow-ref="topics"]',
    );
    return {
      checked: checkbox?.checked,
      checkedAttribute: checkbox?.getAttribute("checked"),
      defaultChecked: checkbox?.defaultChecked,
      region: select?.value,
      regionOptions: Array.from(select?.options ?? []).map((option) => ({
        selectedAttribute: option.getAttribute("selected"),
        defaultSelected: option.defaultSelected,
        selected: option.selected,
      })),
      detailsOpen: detailsElement?.open,
      detailsAttribute: detailsElement?.getAttribute("open"),
      topicOptions: Array.from(topicsSelect?.options ?? []).map((option) => ({
        selectedAttribute: option.getAttribute("selected"),
        defaultSelected: option.defaultSelected,
        selected: option.selected,
      })),
    };
  });
  expect(dirtyNative).toEqual({
    checked: false,
    checkedAttribute: "",
    defaultChecked: true,
    region: "north",
    regionOptions: [
      { selectedAttribute: null, defaultSelected: false, selected: true },
      { selectedAttribute: "", defaultSelected: true, selected: false },
    ],
    detailsOpen: false,
    detailsAttribute: null,
    topicOptions: [
      { selectedAttribute: null, defaultSelected: false, selected: true },
      { selectedAttribute: "", defaultSelected: true, selected: false },
      { selectedAttribute: null, defaultSelected: false, selected: true },
    ],
  });

  await form.evaluate((element) => {
    (element as HTMLFormElement).reset();
  });
  await expect(name).toHaveValue("Ada");
  await expect(notes).toHaveValue("First note\nSecond note");
  await expect(enabled).toBeChecked();
  await expect(form.locator('[name="plan"][value="pro"]')).toBeChecked();
  await expect(region).toHaveValue("south");
  expect(await selectedTopics()).toEqual(["blue"]);
  // Native form reset does not reset <details>; its open state remains browser-local.
  await expect(details).not.toHaveAttribute("open");

  await form.locator('button[type="submit"]').click();
  await expect(details).toHaveAttribute("open", "");
  await expect(name).toHaveValue("Ada");
});

// @spec SPEC-HTML-121 SPEC-HTML-122 SPEC-HTML-126
test("delegated form events expose native event and element values with explicit submit handling", async ({
  page,
}) => {
  await page.goto("/e2e/forms");

  const name = page.locator('#forms-root [data-flow-ref="name"]');
  await name.focus();
  await name.press("k");
  await expect(page.locator("#event-log")).toContainText("focus");
  await expect(page.locator("#event-log")).toContainText("focusin");
  await expect(page.locator("#event-log")).toContainText("keydown:k");
  await name.blur();
  await expect(page.locator("#event-log")).toContainText("blur");
  await expect(page.locator("#event-log")).toContainText("focusout");

  await name.evaluate((element) => {
    for (const type of [
      "compositionstart",
      "compositionupdate",
      "compositionend",
    ]) {
      element.dispatchEvent(
        new CompositionEvent(type, { bubbles: true, data: "漢" }),
      );
    }
  });
  await expect(page.locator("#event-log")).toContainText("compositionstart");
  await expect(page.locator("#event-log")).toContainText("compositionupdate");
  await expect(page.locator("#event-log")).toContainText("compositionend");
  await expect(name).toBeAttached();

  await page.locator('#forms-root button[type="button"]').click();
  await expect(page.locator("#event-log")).toContainText(
    "click:click:true:Record click arguments:native-button:Ada",
  );

  await name.fill("Submitted draft");
  await page
    .locator('#forms-root [data-flow-ref="notes"]')
    .fill("Submitted note");
  await page.locator('#forms-root [data-flow-ref="enabled"]').uncheck();
  await page
    .locator('#forms-root [data-flow-ref="region"]')
    .selectOption("north");
  await page.locator('#forms-root button[type="submit"]').click();

  await expect(page.locator("#submit-result")).toContainText("Submitted draft");
  await expect(page.locator("#submit-result")).toContainText('"topics","blue"');
  await expect(page.locator("#submit-result")).not.toContainText('"locked"');
  await expect(page.locator("#replacement-result")).toContainText(
    '"oldDetached":true',
  );
  await expect(page.locator("#replacement-result")).toContainText(
    '"replaced":true',
  );
  await expect(page.locator("#replacement-result")).toContainText(
    '"renderedValue":"Submitted draft"',
  );
  await expect(page.locator('#forms-root [data-flow-ref="name"]')).toHaveValue(
    "Submitted draft",
  );
  await expect(
    page.locator('#forms-root [data-flow-ref="enabled"]'),
  ).not.toBeChecked();
  await expect(
    page.locator('#forms-root [data-flow-ref="region"]'),
  ).toHaveValue("north");
  await page.locator('#forms-root button[type="button"]').click();
  await expect(page.locator("#event-log")).toContainText(
    "click:click:true:Record click arguments:native-button:Submitted draft",
  );
});

// @spec SPEC-HTML-118 SPEC-HTML-123 SPEC-HTML-125
test("explicit replacement creates fresh controls and escaped form input stays inert", async ({
  page,
}) => {
  await page.goto("/e2e/forms");
  const name = page.locator('#forms-root [data-flow-ref="name"]');
  await name.focus();
  const hostile = `"><img src=x onerror="window.__flowXss=1"><script>window.__flowXss=2</script>`;
  const oldInput = await name.elementHandle();
  await name.fill(hostile);
  await name.press("Enter");
  await expect(page.locator("#replacement-result")).toContainText(
    '"oldDetached":true',
  );
  await expect(page.locator("#replacement-result")).toContainText(
    '"replaced":true',
  );
  await expect(page.locator("#replacement-result")).toContainText(
    '"wasFocused":true',
  );
  await expect(page.locator("#replacement-result")).toContainText(
    '"focusOnNewNode":false',
  );
  await expect(page.locator("#replacement-result")).toContainText(
    `"selectionStartBefore":${hostile.length}`,
  );
  await expect(page.locator("#replacement-result")).toContainText(
    '"selectionStartAfter":0',
  );
  expect(await oldInput?.evaluate((element) => element.isConnected)).toBe(
    false,
  );
  await expect(name).toHaveValue(hostile);
  await expect(
    page.locator('#forms-root [data-flow-ref="escaped-name"]'),
  ).toHaveText(hostile);
  await expect(page.locator("#forms-root img, #forms-root script")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => (window as typeof window & { __flowXss?: number }).__flowXss,
    ),
  ).toBeUndefined();
});

// @spec SPEC-HTML-124
test("binding every input emission replaces the actively edited control", async ({
  page,
}) => {
  await page.goto("/e2e/forms");
  const name = page.locator('#bound-root [data-flow-ref="name"]');
  const oldInput = await name.elementHandle();
  await name.focus();
  await name.press("x");

  await expect(page.locator("#bound-result")).toContainText(
    '"oldDetached":true',
  );
  await expect(page.locator("#bound-result")).toContainText(
    '"wasFocused":true',
  );
  await expect(page.locator("#bound-result")).toContainText(
    '"focusOnNewNode":false',
  );
  await expect(page.locator('#bound-root [data-flow-ref="name"]')).toHaveValue(
    "xAda",
  );
  expect(await oldInput?.evaluate((element) => element.isConnected)).toBe(
    false,
  );
});
