// Release-artifact gate: proves the packed tarballs are the complete,
// well-formed, publishable npm surface. Runs against a directory produced by
// scripts/pack-release-artifacts.mjs and never publishes anything.
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  INTERNAL_DEPENDENCY_SECTIONS,
  collectManifestTargets,
  listTarEntries,
  loadArtifactSet,
  readPackedManifests,
  run,
  tarballPath,
  verifyIntegrity,
} from "./lib/packed-artifacts.mjs";
import {
  discoverPublishablePackages,
  repositoryRoot,
} from "./lib/release-packages.mjs";

const directoryArgument = process.argv[2];
if (!directoryArgument) {
  throw new Error(
    "Usage: node scripts/verify-release-artifacts.mjs <packed-artifact-directory>",
  );
}

// Files that must exist beyond what `exports`/`main`/`types` already promise.
const EXTRA_REQUIRED_FILES = {
  "@flowview/compiler": [
    "pkg/package.json",
    "pkg/flowview_wasm.js",
    "pkg/flowview_wasm.d.ts",
    "pkg/flowview_wasm_bg.wasm",
    "pkg/flowview_wasm_bg.wasm.d.ts",
  ],
  "@flowview/vite": ["client.d.ts"],
};
const TEXT_EXTENSIONS = /\.(?:[cm]?js|d\.[cm]?ts|[cm]?ts|json|map|md|html)$/;
const LOCAL_PATH_MARKERS = [
  repositoryRoot,
  repositoryRoot.replaceAll("\\", "/"),
];

const set = await loadArtifactSet(directoryArgument);
const publishable = await discoverPublishablePackages();
const packedManifests = readPackedManifests(set);
const scratch = await mkdtemp(join(tmpdir(), "flowview-release-artifacts-"));
const problems = [];

try {
  checkArtifactSetMatchesWorkspace();
  for (const artifact of set.artifacts) {
    await verifyArtifact(artifact);
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} release artifact problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(
      `\nRelease artifacts passed: ${set.artifacts.length} tarballs validated and dry-run published`,
    );
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function checkArtifactSetMatchesWorkspace() {
  const packed = new Set(set.artifacts.map((artifact) => artifact.name));
  for (const { name, manifest } of publishable) {
    const artifact = set.byName.get(name);
    if (!artifact) problems.push(`${name} is publishable but was not packed`);
    else if (artifact.version !== manifest.version)
      problems.push(
        `${name} was packed at ${artifact.version}, workspace is ${manifest.version}`,
      );
    packed.delete(name);
  }
  for (const extra of packed)
    problems.push(`${extra} was packed but is not publishable`);
}

async function verifyArtifact(artifact) {
  const { name } = artifact;
  const fail = (message) => problems.push(`${name}: ${message}`);
  const tarball = tarballPath(set, artifact);
  try {
    await verifyIntegrity(set, artifact);
  } catch (error) {
    fail(error.message);
    return;
  }
  const entries = listTarEntries(tarball);
  const manifest = packedManifests.get(name);

  if (!entries.has("package/package.json")) return fail("no package.json");
  if (manifest.name !== name || manifest.version !== artifact.version)
    fail(`manifest is ${manifest.name}@${manifest.version}`);
  for (const field of ["license", "description", "repository"]) {
    if (!manifest[field]) fail(`manifest is missing "${field}"`);
  }

  // Every file the manifest points at must be inside the tarball.
  const targets = collectManifestTargets(manifest);
  if (targets.length === 0) fail("manifest declares no entry points");
  for (const target of targets) {
    if (typeof target !== "string" || !target.startsWith("./")) {
      fail(`entry point ${JSON.stringify(target)} is not a "./" relative path`);
      continue;
    }
    const normalized = posix.normalize(target.slice(2));
    if (normalized.startsWith("..") || posix.isAbsolute(normalized)) {
      fail(`entry point ${target} points outside the tarball`);
    } else if (!entries.has(`package/${normalized}`)) {
      fail(`entry point ${target} is missing from the tarball`);
    }
  }
  for (const extra of EXTRA_REQUIRED_FILES[name] ?? []) {
    if (!entries.has(`package/${extra}`)) fail(`tarball is missing ${extra}`);
  }
  if (!targets.some((t) => /\.d\.[cm]?ts$/.test(t)))
    fail("manifest declares no types entry");
  const wasm = [...entries].find((entry) => entry.endsWith(".wasm"));
  if (name === "@flowview/compiler" && wasm) {
    const size = await extractedSize(tarball, wasm);
    if (size < 1024) fail(`${wasm} is implausibly small (${size} bytes)`);
  }

  // Dependency metadata as published.
  for (const section of [...INTERNAL_DEPENDENCY_SECTIONS, "devDependencies"]) {
    for (const [dependency, range] of Object.entries(manifest[section] ?? {})) {
      if (/^(workspace|file|link|portal):/.test(range))
        fail(`${section}.${dependency} is "${range}" (unresolved protocol)`);
      if (!dependency.startsWith("@flowview/") || section === "devDependencies")
        continue;
      const sibling = set.byName.get(dependency);
      if (!sibling) fail(`${section}.${dependency} has no packed tarball`);
      else if (!satisfies(sibling.version, range))
        fail(
          `${section}.${dependency} "${range}" does not accept the packed ${sibling.version}`,
        );
    }
  }

  // No leakage from the checkout, in any text file in the tarball.
  const extractDirectory = join(scratch, name.replace("/", "__"));
  await mkdir(extractDirectory, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", extractDirectory]);
  for (const entry of entries) {
    if (entry.endsWith("/") || !TEXT_EXTENSIONS.test(entry)) continue;
    const text = await readFile(join(extractDirectory, entry), "utf8");
    if (LOCAL_PATH_MARKERS.some((marker) => text.includes(marker)))
      fail(`${entry} references the FlowView checkout (${repositoryRoot})`);
    if (entry === "package/package.json" && text.includes("workspace:"))
      fail("package.json still contains a workspace: protocol");
  }

  dryRunPublish(tarball, fail);
  console.log(`Validated ${name}@${artifact.version}`);
}

function dryRunPublish(tarball, fail) {
  try {
    run(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "publish",
        tarball,
        "--dry-run",
        "--access",
        "public",
        "--ignore-scripts",
        "--tag",
        "latest",
      ],
      { capture: true, cwd: scratch },
    );
  } catch (error) {
    fail(`npm publish --dry-run rejected the tarball:\n${error.message}`);
  }
}

async function extractedSize(tarball, entry) {
  const directory = await mkdtemp(join(scratch, "size-"));
  run("tar", ["-xzf", tarball, "-C", directory, entry]);
  return (await stat(join(directory, ...entry.split("/")))).size;
}

/** `^x.y.z`, `~x.y.z` and exact versions: all pnpm emits for `workspace:` specs. */
function satisfies(version, range) {
  const parse = (text) => text.split("-")[0].split(".").map(Number);
  const [major, minor, patch] = parse(version);
  const match = /^([\^~]?)(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(range);
  if (!match) return false;
  const [, operator, base] = match;
  const [bMajor, bMinor, bPatch] = parse(base);
  const atLeast =
    major > bMajor ||
    (major === bMajor &&
      (minor > bMinor || (minor === bMinor && patch >= bPatch)));
  if (operator === "") return version === base;
  if (!atLeast) return false;
  if (operator === "~") return major === bMajor && minor === bMinor;
  if (bMajor > 0) return major === bMajor;
  if (bMinor > 0) return major === 0 && minor === bMinor;
  return major === 0 && minor === 0 && patch === bPatch;
}
