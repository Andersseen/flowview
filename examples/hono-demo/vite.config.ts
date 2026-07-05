import flowview from "@flowview/vite";
import flowviewEvents from "@flowview/vite-events";
import { defineConfig } from "vite";

export default defineConfig(({ command, isSsrBuild }) => {
  // `flowviewEvents()` must run for both builds (the client build resolves
  // the virtual events module; the SSR build rewrites the .flow template).
  // `flowview()` (the HTML compiler) is only needed where a `.flow` file is
  // actually imported: the SSR build, and the dev server's single graph.
  const needsFlowviewHtml = command === "serve" || isSsrBuild === true;

  return {
    plugins: [flowviewEvents(), ...(needsFlowviewHtml ? [flowview()] : [])],
    build: {
      outDir: isSsrBuild ? "dist/server" : "dist/client",
      manifest: !isSsrBuild,
      rollupOptions: isSsrBuild
        ? { output: { entryFileNames: "render.js" } }
        : { input: "src/entry-client.ts" },
    },
  };
});
