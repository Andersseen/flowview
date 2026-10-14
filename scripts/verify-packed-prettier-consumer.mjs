// External Prettier consumer: installs @flowview/prettier from its packed
// tarball next to a chosen Prettier version and formats an Astro file.
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  assertLockfileUsesPackedTarballs,
  internalClosure,
  loadArtifactSet,
  pnpmExecutable,
  removeRustFromPath,
  run,
  tarballPath,
  verifyIntegrity,
} from "./lib/packed-artifacts.mjs";

const usage =
  "Usage: node scripts/verify-packed-prettier-consumer.mjs <packed-artifact-directory> [--prettier <version-or-range>]";
const positional = [];
let prettierVersion = "^3.0.0";
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--prettier") prettierVersion = process.argv[++index] ?? "";
  else positional.push(argument);
}
if (positional.length !== 1 || !prettierVersion) throw new Error(usage);

const artifactSet = await loadArtifactSet(positional[0]);
const closureNames = internalClosure(artifactSet, ["@flowview/prettier"]);
const artifacts = closureNames.map((name) => artifactSet.byName.get(name));
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "flowview-packed-prettier-"),
);
const consumerRoot = join(temporaryRoot, "consumer");
const artifactsDirectory = join(temporaryRoot, "packed-artifacts");
let keep = false;

try {
  await mkdir(consumerRoot, { recursive: true });
  await mkdir(artifactsDirectory, { recursive: true });
  for (const artifact of artifacts) {
    await verifyIntegrity(artifactSet, artifact);
    await copyFile(
      tarballPath(artifactSet, artifact),
      join(artifactsDirectory, artifact.file),
    );
  }
  const [physicalRoot, physicalArtifacts] = await Promise.all([
    realpath(consumerRoot),
    realpath(artifactsDirectory),
  ]);
  const dependencies = Object.fromEntries(
    artifacts.map((artifact) => [
      artifact.name,
      `file:${relative(physicalRoot, join(physicalArtifacts, artifact.file)).split(sep).join("/")}`,
    ]),
  );
  await writeFile(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({ name: "flowview-packed-prettier-consumer", private: true, type: "module", pnpm: { overrides: dependencies }, dependencies: { ...dependencies, prettier: prettierVersion } }, null, 2)}\n`,
  );
  await writeFile(
    join(consumerRoot, "check.mjs"),
    `import { format } from "prettier";
import plugin from "@flowview/prettier";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync("node_modules/prettier/package.json", "utf8")).version;
const template = \`<template flowview={context} is:raw>
  <ol   class="list">
    @for (item of context.items; track item.id) {
      <li>{{   item.name }}</li>
    } @empty {
      <li>None</li>
    }
  </ol>
</template>\`;
const source = "---\\nconst context = { items: [] };\\n---\\n\\n<div   class='a'>x</div>\\n" + template + "\\n";
const result = await format(source, { parser: "astro", plugins: [plugin] });
if (!result.includes(template)) throw new Error("flowview template region was modified:\\n" + result);
if (!result.includes('<div class="a">x</div>')) throw new Error("surrounding Astro markup was not formatted:\\n" + result);
console.log(JSON.stringify({ version }));
`,
  );
  removeRustFromPath();
  const pnpm = pnpmExecutable();
  run(
    pnpm,
    [
      "install",
      "--no-frozen-lockfile",
      "--store-dir",
      join(temporaryRoot, "pnpm-store"),
    ],
    { cwd: consumerRoot },
  );
  await assertLockfileUsesPackedTarballs(
    consumerRoot,
    artifactSet,
    closureNames,
  );
  const output = run(process.execPath, ["check.mjs"], {
    cwd: consumerRoot,
    capture: true,
  });
  const { version } = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  const installed = JSON.parse(
    await readFile(
      join(consumerRoot, "node_modules/prettier/package.json"),
      "utf8",
    ),
  ).version;
  console.log(
    `Packed Prettier plugin formatted Astro on Prettier ${version} (${installed}) on ${process.platform}`,
  );
} catch (error) {
  keep = true;
  console.error(
    `Packed Prettier consumer failed. Project preserved at ${consumerRoot}`,
  );
  throw error;
} finally {
  if (!keep && process.env.FLOWVIEW_KEEP_PACKED_CONSUMER !== "1") {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
