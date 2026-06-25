import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import flowmark from "@flowmark/astro";
import flowmarkEvents from "@flowmark/astro-events";

export default defineConfig({
  site: "https://flowmark.example",
  integrations: [flowmark(), flowmarkEvents()],
  vite: {
    plugins: [tailwindcss()],
  },
});
