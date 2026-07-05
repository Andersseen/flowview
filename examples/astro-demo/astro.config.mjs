import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import flowmark from "@flowview/astro";
import flowmarkEvents from "@flowview/astro-events";

export default defineConfig({
  site: "https://flowmark.example",
  integrations: [flowmark(), flowmarkEvents()],
  vite: {
    plugins: [tailwindcss()],
  },
});
