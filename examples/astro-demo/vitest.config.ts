/// <reference types="vitest/config" />

import { getViteConfig } from "astro/config";
import type { UserConfig as VitestConfig } from "vitest/config";

const config = {
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
} satisfies VitestConfig;

// Astro and Vitest can resolve separate Vite type instances in a workspace.
// The object is validated above with Vitest's own config type before crossing
// the Astro helper boundary.
export default getViteConfig(config as Parameters<typeof getViteConfig>[0]);
