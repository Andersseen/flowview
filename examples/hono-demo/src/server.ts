import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import type { ViteDevServer } from "vite";
import {
  renderPage,
  resolveClientScriptTag,
  type ViteManifest,
} from "./manifest.js";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3000);

// A non-literal specifier keeps TypeScript from resolving this module at
// typecheck time — it only exists after `pnpm run build:server`.
const renderModulePath = new URL("../dist/server/render.js", import.meta.url)
  .href;

const app = new Hono<{ Bindings: HttpBindings }>();

let vite: ViteDevServer | undefined;

if (!isProduction) {
  const { createServer } = await import("vite");
  vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });

  // Delegate asset/HMR requests to Vite's own middleware stack; requests it
  // doesn't handle (like our page route below) fall through to Hono.
  app.use(async (context, next) => {
    await new Promise<void>((resolve) => {
      vite!.middlewares(context.env.incoming, context.env.outgoing, () =>
        resolve(),
      );
    });
    await next();
  });
} else {
  app.use("/assets/*", serveStatic({ root: "./dist/client" }));
}

app.get("/", async (context) => {
  const scriptTag = vite
    ? '<script type="module" src="/src/entry-client.ts"></script>'
    : await resolveProdScriptTag();

  const { render } = vite
    ? await vite.ssrLoadModule("/src/pages/index.flow")
    : ((await import(renderModulePath)) as {
        render: (context: unknown) => string;
      });

  const body = render({
    items: ["Buy milk", "Walk the dog", "Ship flowview"],
  });

  return context.html(renderPage(body, scriptTag));
});

async function resolveProdScriptTag(): Promise<string> {
  const manifestUrl = new URL(
    "../dist/client/.vite/manifest.json",
    import.meta.url,
  );
  const manifest = JSON.parse(
    await readFile(manifestUrl, "utf8"),
  ) as ViteManifest;
  return resolveClientScriptTag(manifest, "src/entry-client.ts");
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`hono-demo listening on http://localhost:${info.port}`);
});
