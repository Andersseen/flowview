import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import flowview from "@flowview/astro";
import flowviewEvents from "@flowview/astro-events";

export default defineConfig({
  site: "https://flowview.example",
  integrations: [flowviewEvents(), flowview()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        // Compiled `<script data-flowview>` blocks run as virtual modules
        // whose id is not a real file path, so relative imports out of them
        // are unreliable. An alias resolves the same regardless.
        "@/state": fileURLToPath(new URL("./src/state", import.meta.url)),
      },
    },
  },
});
