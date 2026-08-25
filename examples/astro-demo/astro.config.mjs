import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import flowview from "@flowview/astro";
import flowviewEvents from "@flowview/astro-events";

export default defineConfig({
  site: "https://flowview.example",
  integrations: [flowviewEvents(), flowview()],
  vite: {
    plugins: [tailwindcss()],
  },
});
