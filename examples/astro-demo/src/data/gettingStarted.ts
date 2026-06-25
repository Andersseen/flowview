import type { GettingStartedContext } from "./types";

/**
 * Context for the Getting Started Flowmark template.
 */
export const gettingStartedContext: GettingStartedContext = {
  title: "Get started",
  description:
    "Add Flowmark to an Astro project and embed your first template region.",
  steps: [
    {
      label: "Install",
      code: "npm install @flowmark/astro @flowmark/runtime",
      description: "Add the Astro integration and runtime to your project.",
      className: "bento-install",
    },
    {
      label: "Configure",
      code: `import flowmark from "@flowmark/astro";

export default defineConfig({
  integrations: [flowmark()],
});`,
      description: "Register the integration in your astro.config.mjs file.",
      className: "bento-configure",
    },
    {
      label: "Write",
      code: `<!-- prettier-ignore -->
<template flowmark is:raw context={context}>
  @for (item of context.items; track item.id) {
    <p>{{ item.name }}</p>
  }
</template>`,
      description: "Add a Flowmark region to any .astro component.",
      className: "bento-write",
    },
  ],
};
