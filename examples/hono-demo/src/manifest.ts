export interface ViteManifestChunk {
  file: string;
  isEntry?: boolean;
}

export type ViteManifest = Record<string, ViteManifestChunk>;

/** Resolves the hashed client entry file from Vite's production build manifest. */
export function resolveClientScriptTag(
  manifest: ViteManifest,
  entryKey: string,
): string {
  const chunk = manifest[entryKey];
  if (chunk === undefined) {
    throw new Error(
      `No "${entryKey}" entry found in the client build manifest. Did the client build run?`,
    );
  }
  return `<script type="module" src="/${chunk.file}"></script>`;
}

/** Wraps a `render(context)` result and a client `<script>` tag in a full HTML document. */
export function renderPage(body: string, scriptTag: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>flowview + Hono</title>
  </head>
  <body>
    ${body}
    ${scriptTag}
  </body>
</html>
`;
}
