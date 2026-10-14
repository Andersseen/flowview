import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { INTERNAL_DEPENDENCY_SECTIONS } from "./release-packages.mjs";

export { INTERNAL_DEPENDENCY_SECTIONS };

/** Reads `packed-flowview-packages.json` and returns the artifact set. */
export async function loadArtifactSet(directory) {
  const root = resolve(directory);
  const manifest = JSON.parse(
    await readFile(join(root, "packed-flowview-packages.json"), "utf8"),
  );
  const byName = new Map(manifest.artifacts.map((a) => [a.name, a]));
  return { root, artifacts: manifest.artifacts, byName };
}

export function tarballPath(set, artifact) {
  return join(set.root, artifact.file);
}

export async function verifyIntegrity(set, artifact) {
  const bytes = await readFile(tarballPath(set, artifact));
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (integrity !== artifact.integrity) {
    throw new Error(`Integrity mismatch for ${artifact.file}`);
  }
}

export function listTarEntries(tarball) {
  return new Set(
    run("tar", ["-tzf", tarball], { capture: true }).trim().split(/\r?\n/),
  );
}

export function readTarJson(tarball, entry) {
  return JSON.parse(run("tar", ["-xOzf", tarball, entry], { capture: true }));
}

/** Packed manifests (as published, i.e. after pnpm rewrote `workspace:`). */
export function readPackedManifests(set) {
  return new Map(
    set.artifacts.map((artifact) => [
      artifact.name,
      readTarJson(tarballPath(set, artifact), "package/package.json"),
    ]),
  );
}

/** Transitive `@flowview/*` closure of `roots` over the packed manifests. */
export function internalClosure(set, roots) {
  const manifests = readPackedManifests(set);
  const seen = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    const manifest = manifests.get(name);
    if (!manifest) throw new Error(`No packed artifact for ${name}`);
    seen.add(name);
    for (const section of INTERNAL_DEPENDENCY_SECTIONS) {
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        if (dependency.startsWith("@flowview/")) pending.push(dependency);
      }
    }
  }
  return [...seen].sort();
}

/** Every file path a manifest promises: exports, main/module/types, bin. */
export function collectManifestTargets(manifest) {
  const targets = [];
  const walk = (value) => {
    if (typeof value === "string") targets.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      Object.values(value).forEach(walk);
  };
  walk(manifest.exports);
  for (const field of ["main", "module", "types", "typings"]) {
    if (typeof manifest[field] === "string") targets.push(manifest[field]);
  }
  walk(manifest.bin);
  return [...new Set(targets)];
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stderr ?? ""}`,
    );
  }
  return options.capture ? result.stdout : "";
}

export function pnpmExecutable() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function pathExtensions() {
  return process.platform === "win32"
    ? [
        "",
        ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
          .split(";")
          .map((value) => value.toLowerCase()),
      ]
    : [""];
}

const RUST_TOOLS = ["cargo", "rustc", "wasm-pack"];

function pathHasTool(directory, tool) {
  return pathExtensions().some((extension) =>
    existsSync(join(directory, `${tool}${extension}`)),
  );
}

/**
 * Consumers must work without a Rust toolchain. Strip any directory that
 * provides one from PATH and prove none is left.
 */
export function removeRustFromPath() {
  process.env.PATH = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .filter((entry) => !RUST_TOOLS.some((tool) => pathHasTool(entry, tool)))
    .join(delimiter);
  for (const tool of RUST_TOOLS) {
    const left = (process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .find((entry) => pathHasTool(entry, tool));
    if (left) {
      throw new Error(`Rust tool ${tool} is still available in ${left}`);
    }
  }
  delete process.env.FLOWVIEW_COMPILER_PATH;
}

/**
 * Proves, from the consumer's pnpm lockfile, that every `@flowview/*` package
 * was installed from the packed tarball (same sha512 as the pack manifest) and
 * that nothing else in the `@flowview` scope was pulled from a registry or the
 * workspace.
 */
export async function assertLockfileUsesPackedTarballs(
  consumerRoot,
  set,
  closureNames,
) {
  const lockfile = await readFile(join(consumerRoot, "pnpm-lock.yaml"), "utf8");
  const lines = lockfile.split(/\r?\n/);
  const locked = new Map();
  let inPackages = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line)) inPackages = line.startsWith("packages:");
    if (!inPackages) continue;
    const match = /^ {2}'(@flowview\/[^@']+)@([^']+)':\s*$/.exec(line);
    if (!match) continue;
    const resolution = lines[index + 1] ?? "";
    locked.set(match[1], { key: match[2], resolution });
  }
  const lockedNames = [...locked.keys()].sort();
  if (
    JSON.stringify(lockedNames) !== JSON.stringify([...closureNames].sort())
  ) {
    throw new Error(
      `Lockfile @flowview packages [${lockedNames}] differ from the expected graph [${closureNames}]`,
    );
  }
  for (const name of closureNames) {
    const artifact = set.byName.get(name);
    const { key, resolution } = locked.get(name);
    if (!key.startsWith("file:") || !key.includes(artifact.file)) {
      throw new Error(`${name} is locked as ${key}, not its packed tarball`);
    }
    if (
      !resolution.includes(`integrity: ${artifact.integrity}`) ||
      !resolution.includes(`tarball: file:`)
    ) {
      throw new Error(
        `${name} lockfile resolution does not match the packed tarball integrity: ${resolution.trim()}`,
      );
    }
  }
  console.log(
    `Lockfile pins all ${closureNames.length} @flowview packages to the packed tarballs`,
  );
}
