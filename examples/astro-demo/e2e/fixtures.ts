import { expect, test as base } from "@playwright/test";

/**
 * `test` with a runtime error gate: any uncaught page exception or
 * `console.error` fails the test, even when every locator assertion passed.
 *
 * A scenario that deliberately triggers a known browser error opts in with
 * `test.use({ allowedErrors: [/exact message/] })` instead of silencing the
 * gate globally.
 */
export const test = base.extend<{
  allowedErrors: RegExp[];
  runtimeErrors: string[];
}>({
  allowedErrors: [[], { option: true }],
  runtimeErrors: [
    async ({ page, allowedErrors }, use) => {
      const errors: string[] = [];
      const record = (message: string) => {
        if (!allowedErrors.some((pattern) => pattern.test(message))) {
          errors.push(message);
        }
      };
      page.on("pageerror", (error) => record(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") {
          record(`console.error: ${message.text()}`);
        }
      });
      await use(errors);
      expect(errors, "unexpected browser runtime errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
