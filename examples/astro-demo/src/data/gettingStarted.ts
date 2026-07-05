import type { GettingStartedContext } from "./types";

/**
 * Context for the Getting Started flowview template.
 */
export const gettingStartedContext: GettingStartedContext = {
  title: "Get started",
  description:
    "Add flowview to an Astro project and embed your first template region.",
  steps: [
    {
      label: "Install",
      code: "npm install @flowview/astro @flowview/runtime",
      description: "Add the Astro integration and runtime to your project.",
      className: "bento-install",
    },
    {
      label: "Configure",
      code: `import flowview from "@flowview/astro";

export default defineConfig({
  integrations: [flowview()],
});`,
      description: "Register the integration in your astro.config.mjs file.",
      className: "bento-configure",
    },
    {
      label: "Write",
      code: `<template flowview={context} is:raw>
  @for (item of context.items; track item.id) {
    <p>{{ item.name }}</p>
  }
</template>`,
      description: "Add a flowview region to any .astro component.",
      className: "bento-write",
    },
  ],
};
