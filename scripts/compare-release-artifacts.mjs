// Asserts that two packed artifact sets contain the same package contents.
// Used to show that what Changesets would publish (re-packed from the built
// outputs of the pack job) is what the release gates verified. Tarball bytes
// are not compared directly: pnpm orders `package.json` dependency keys by
// install order, so JSON files are compared structurally (key order ignored).
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadArtifactSet, run, tarballPath } from "./lib/packed-artifacts.mjs";

const [expectedArgument, actualArgument] = process.argv.slice(2);
if (!expectedArgument || !actualArgument) {
  throw new Error(
    "Usage: node scripts/compare-release-artifacts.mjs <verified-directory> <repacked-directory>",
  );
}

const expected = await loadArtifactSet(expectedArgument);
const actual = await loadArtifactSet(actualArgument);
const scratch = await mkdtemp(join(tmpdir(), "flowview-compare-artifacts-"));
const problems = [];

try {
  const names = new Set([...expected.byName.keys(), ...actual.byName.keys()]);
  for (const name of [...names].sort()) {
    const left = expected.byName.get(name);
    const right = actual.byName.get(name);
    if (!left || !right) {
      problems.push(`${name} is only present in one artifact set`);
      continue;
    }
    if (left.version !== right.version)
      problems.push(`${name}: ${left.version} vs ${right.version}`);
    const a = await digestTarball(expected, left, "expected");
    const b = await digestTarball(actual, right, "actual");
    for (const file of new Set([...a.keys(), ...b.keys()])) {
      if (a.get(file) !== b.get(file))
        problems.push(`${name}: ${file} differs between the two builds`);
    }
    console.log(`Compared ${name}@${left.version}: ${a.size} files`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`\nArtifact sets differ:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log("\nBoth artifact sets contain identical package contents");

async function digestTarball(set, artifact, label) {
  const directory = join(scratch, label, artifact.file);
  await mkdir(directory, { recursive: true });
  run("tar", ["-xzf", tarballPath(set, artifact), "-C", directory]);
  const digests = new Map();
  for (const file of await listFiles(directory)) {
    const bytes = await readFile(join(directory, file));
    const content = file.endsWith(".json")
      ? JSON.stringify(canonical(JSON.parse(bytes.toString("utf8"))))
      : bytes;
    digests.set(file, createHash("sha256").update(content).digest("hex"));
  }
  return digests;
}

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await listFiles(directory, relative)));
    else files.push(relative);
  }
  return files;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
