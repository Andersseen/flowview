import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/runtime/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
});
