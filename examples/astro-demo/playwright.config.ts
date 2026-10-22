import { defineConfig, devices } from "@playwright/test";

// `FLOWVIEW_E2E_TARGET=preview` runs only the product acceptance suite
// against the production build served by `astro preview`. The default target
// is the full suite against `astro dev`.
const preview = process.env.FLOWVIEW_E2E_TARGET === "preview";
const port = preview ? 4322 : 4321;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: preview
    ? [
        "capabilities.spec.ts",
        "client-dom.spec.ts",
        "view-composition.spec.ts",
        "forms.spec.ts",
      ]
    : "*.spec.ts",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: preview
      ? `pnpm exec astro preview --host 127.0.0.1 --port ${port}`
      : "pnpm run dev:e2e",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
