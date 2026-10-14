import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { discoverPublishablePackages } from "./lib/release-packages.mjs";

const outputArgument = process.argv[2];
if (!outputArgument) {
  throw new Error(
    "Usage: node scripts/pack-release-artifacts.mjs <empty-output-directory>",
  );
}

const outputDirectory = resolve(outputArgument);
await mkdir(outputDirectory, { recursive: true });
if ((await readdir(outputDirectory)).length > 0) {
  throw new Error(`Pack output directory must be empty: ${outputDirectory}`);
}

// Pack every publishable package once. Every later gate (artifact validation,
// npm dry-run, OS consumers, version-compatibility consumers) consumes this
// exact set; the manifest records each tarball's sha512 so that identity can
// be re-checked after download.
const artifacts = [];
for (const {
  name,
  directory,
  manifest,
} of await discoverPublishablePackages()) {
  const before = new Set(await readdir(outputDirectory));
  await runPnpmPack(directory, outputDirectory);
  const created = (await readdir(outputDirectory)).filter(
    (entry) => entry.endsWith(".tgz") && !before.has(entry),
  );
  if (created.length !== 1) {
    throw new Error(
      `pnpm pack for ${name} produced ${created.length} tarballs; expected one`,
    );
  }
  const filename = created[0];
  const bytes = await readFile(join(outputDirectory, filename));
  artifacts.push({
    name,
    version: manifest.version,
    file: filename,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  });
  console.log(`Packed ${name}@${manifest.version} → ${filename}`);
}

await writeFile(
  join(outputDirectory, "packed-flowview-packages.json"),
  `${JSON.stringify({ artifacts }, null, 2)}\n`,
);

function runPnpmPack(packageDirectory, destination) {
  return new Promise((resolvePromise, rejectPromise) => {
    const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(
      executable,
      ["pack", `--pack-destination=${destination}`],
      {
        cwd: packageDirectory,
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else
        rejectPromise(
          new Error(`pnpm pack failed for ${packageDirectory} (${code})`),
        );
    });
  });
}
