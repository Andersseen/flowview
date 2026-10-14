import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const INTERNAL_DEPENDENCY_SECTIONS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

/**
 * The publishable npm surface, derived from the workspace: every package under
 * `packages/` that is not `private` and not listed in the Changesets `ignore`
 * array. Nothing else in the repository hardcodes this list.
 */
export async function discoverPublishablePackages() {
  const changesetConfig = JSON.parse(
    await readFile(join(repositoryRoot, ".changeset", "config.json"), "utf8"),
  );
  const ignored = new Set(changesetConfig.ignore ?? []);
  const packages = [];
  for (const entry of await readdir(join(repositoryRoot, "packages"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const directory = join(repositoryRoot, "packages", entry.name);
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (typeof manifest.name !== "string") continue;
    if (manifest.private === true || ignored.has(manifest.name)) continue;
    packages.push({ name: manifest.name, directory, manifest });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  if (packages.length === 0) {
    throw new Error("No publishable packages were discovered under packages/");
  }
  return packages;
}
