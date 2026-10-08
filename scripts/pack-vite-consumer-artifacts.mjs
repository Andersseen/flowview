import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = process.argv[2];

if (!outputArgument) {
  throw new Error(
    "Usage: node scripts/pack-vite-consumer-artifacts.mjs <empty-output-directory>",
  );
}

const outputDirectory = resolve(outputArgument);
await mkdir(outputDirectory, { recursive: true });
if ((await readdir(outputDirectory)).length > 0) {
  throw new Error(`Pack output directory must be empty: ${outputDirectory}`);
}

const packageDirectories = new Map();
for (const entry of await readdir(join(repositoryRoot, "packages"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const directory = join(repositoryRoot, "packages", entry.name);
  try {
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    if (typeof manifest.name === "string") {
      packageDirectories.set(manifest.name, directory);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const packagesToPack = new Map();
const pending = ["@flowview/vite"];
while (pending.length > 0) {
  const name = pending.pop();
  if (!name || packagesToPack.has(name)) continue;
  const directory = packageDirectories.get(name);
  if (!directory) {
    throw new Error(
      `Required Flowview package is missing from packages/: ${name}`,
    );
  }
  const manifest = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  packagesToPack.set(name, { directory, manifest });

  for (const section of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const dependencyName of Object.keys(manifest[section] ?? {})) {
      if (dependencyName.startsWith("@flowview/")) pending.push(dependencyName);
    }
  }
}

for (const required of [
  "@flowview/compiler",
  "@flowview/runtime",
  "@flowview/vite",
]) {
  if (!packagesToPack.has(required)) {
    throw new Error(
      `The @flowview/vite package graph does not include ${required}`,
    );
  }
}

const artifacts = [];
for (const [name, { directory, manifest }] of packagesToPack) {
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
