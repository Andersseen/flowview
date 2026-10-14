// Fails when declared compatibility drifts from tested compatibility:
// peer ranges in publishable manifests, the CI matrix, and docs must all agree
// with scripts/compatibility.json (the single source of truth).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  discoverPublishablePackages,
  repositoryRoot,
} from "./lib/release-packages.mjs";

const contract = JSON.parse(
  await readFile(join(repositoryRoot, "scripts", "compatibility.json"), "utf8"),
);
const workflow = await readFile(
  join(repositoryRoot, ".github", "workflows", "release-readiness.yml"),
  "utf8",
);
const compatibilityDoc = await readFile(
  join(repositoryRoot, "docs", "compatibility.md"),
  "utf8",
);
const readme = await readFile(join(repositoryRoot, "README.md"), "utf8");
const problems = [];

const packages = await discoverPublishablePackages();
const peers = (dependency) =>
  packages
    .filter(({ manifest }) => manifest.peerDependencies?.[dependency])
    .map(({ name, manifest }) => ({
      name,
      range: manifest.peerDependencies[dependency],
    }));

for (const dependency of ["vite", "astro"]) {
  const tested = contract[dependency].majors;
  for (const { name, range } of peers(dependency)) {
    const accepted = acceptedMajors(range);
    if (accepted.join() !== tested.join())
      problems.push(
        `${name} peer ${dependency} "${range}" accepts majors [${accepted}] but CI tests [${tested}]`,
      );
  }
  if (peers(dependency).length === 0)
    problems.push(`no publishable package has a ${dependency} peer range`);
  const matrix = workflowMatrix(dependency);
  if (matrix.join() !== tested.join())
    problems.push(
      `release-readiness.yml ${dependency} matrix [${matrix}] differs from compatibility.json [${tested}]`,
    );
  for (const [label, text] of [
    ["docs/compatibility.md", compatibilityDoc],
    ["README.md", readme],
  ]) {
    for (const major of tested) {
      if (!new RegExp(`${dependency}[^\\n]*\\b${major}\\b`, "i").test(text))
        problems.push(`${label} does not list ${dependency} ${major}`);
    }
  }
}

for (const { name, range } of peers("prettier")) {
  if (range !== "^3.0.0")
    problems.push(`${name} peer prettier "${range}" is not "^3.0.0"`);
}
if (
  workflowMatrix("prettier", true).join() !== contract.prettier.versions.join()
)
  problems.push(
    "release-readiness.yml prettier matrix differs from compatibility.json",
  );

const minimum = contract.node.minimum;
if (!workflow.includes(`node-version: ${minimum}`))
  problems.push(`release-readiness.yml has no job pinned to Node ${minimum}`);
const [major, minor] = minimum.split(".");
for (const [label, text] of [
  ["docs/compatibility.md", compatibilityDoc],
  ["README.md", readme],
]) {
  if (!text.includes(`${major}.${minor}`))
    problems.push(`${label} does not state the Node ${major}.${minor} floor`);
}

if (problems.length > 0) {
  console.error("Compatibility contract violations:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `Compatibility contract holds: Node >=${minimum}, Vite ${contract.vite.majors}, Astro ${contract.astro.majors}, Prettier ${contract.prettier.versions}`,
);

/** Majors 0..99 whose `.0.0` release satisfies a simple semver range. */
function acceptedMajors(range) {
  const accepted = [];
  for (let major = 0; major < 100; major += 1) {
    if (range.split("||").some((part) => satisfiesAll(major, part.trim())))
      accepted.push(major);
  }
  return accepted;
}

function satisfiesAll(major, clause) {
  return clause
    .split(/\s+(?=[<>=^~]|\d)/)
    .filter(Boolean)
    .every((comparator) => {
      const match = /^(\^|~|>=|<=|>|<|=)?(\d+)(?:\.\d+)?(?:\.\d+)?$/.exec(
        comparator.trim(),
      );
      if (!match) throw new Error(`Unsupported range clause: ${comparator}`);
      const [, operator = "=", bound] = match;
      const n = Number(bound);
      switch (operator) {
        case "^":
        case "~":
        case "=":
          return major === n;
        case ">=":
          return major >= n;
        case ">":
          return major > n;
        case "<=":
          return major <= n;
        case "<":
          return major < n;
      }
    });
}

/** Reads `<key>: [a, b, c]` matrix lines from the reusable workflow. */
function workflowMatrix(key, keepStrings = false) {
  const match = new RegExp(`^\\s*${key}: \\[([^\\]]*)\\]`, "m").exec(workflow);
  if (!match) {
    problems.push(`release-readiness.yml has no "${key}: [...]" matrix`);
    return [];
  }
  const values = match[1]
    .split(",")
    .map((value) => value.trim().replace(/^"|"$/g, ""));
  return keepStrings ? values : values.map(Number);
}
