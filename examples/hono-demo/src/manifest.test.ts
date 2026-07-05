import { describe, expect, it } from "vitest";
import {
  renderPage,
  resolveClientScriptTag,
  type ViteManifest,
} from "./manifest.js";

describe("resolveClientScriptTag", () => {
  it("builds a script tag from the manifest entry's hashed file", () => {
    const manifest: ViteManifest = {
      "src/entry-client.ts": {
        file: "assets/entry-client-abc123.js",
        isEntry: true,
      },
    };

    expect(resolveClientScriptTag(manifest, "src/entry-client.ts")).toBe(
      '<script type="module" src="/assets/entry-client-abc123.js"></script>',
    );
  });

  it("throws a descriptive error when the entry is missing", () => {
    expect(() => resolveClientScriptTag({}, "src/entry-client.ts")).toThrow(
      'No "src/entry-client.ts" entry found',
    );
  });
});

describe("renderPage", () => {
  it("wraps the rendered body and script tag in an HTML document", () => {
    const html = renderPage("<main>hi</main>", '<script src="/x.js"></script>');

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<main>hi</main>");
    expect(html).toContain('<script src="/x.js"></script>');
  });
});
