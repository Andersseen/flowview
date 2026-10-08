import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactsArgument = process.argv[2];
if (!artifactsArgument) {
  throw new Error(
    "Usage: node scripts/verify-packed-vite-consumer.mjs <packed-artifact-directory>",
  );
}
const inputArtifactsDirectory = resolve(artifactsArgument);
const artifactManifestPath = join(
  inputArtifactsDirectory,
  "packed-flowview-packages.json",
);
const artifactManifest = JSON.parse(
  await readFile(artifactManifestPath, "utf8"),
);
const artifactByName = new Map(
  artifactManifest.artifacts.map((artifact) => [artifact.name, artifact]),
);
const packedManifestByName = new Map();
for (const name of [
  "@flowview/compiler",
  "@flowview/runtime",
  "@flowview/vite",
]) {
  if (!artifactByName.has(name))
    throw new Error(`Missing packed artifact for ${name}`);
}

const temporaryRoot = await mkdtemp(
  join(tmpdir(), "flowview-packed-consumer-"),
);
const consumerRoot = join(temporaryRoot, "consumer");
const artifactsDirectory = join(temporaryRoot, "packed-artifacts");
const storeDirectory = join(temporaryRoot, "pnpm-store");
let keepTemporaryFiles = false;

async function main() {
  try {
    await mkdir(consumerRoot, { recursive: true });
    await stageTarballs();
    await verifyTarballs();
    const packageJson = await createConsumerProject();
    await installDependencies();
    await verifyInstalledPackages(packageJson);
    await verifyCompiler();
    await verifyDevelopmentPipeline();
    await verifyProductionBuild();
    await verifyTypes();
    console.log(
      `Packed consumer passed on ${process.platform} in ${consumerRoot}`,
    );
  } catch (error) {
    keepTemporaryFiles = true;
    console.error(
      `Packed consumer failed. Project preserved at ${consumerRoot}`,
    );
    throw error;
  } finally {
    if (
      !keepTemporaryFiles &&
      process.env.FLOWVIEW_KEEP_PACKED_CONSUMER !== "1"
    ) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

async function stageTarballs() {
  await mkdir(artifactsDirectory, { recursive: true });
  for (const artifact of artifactManifest.artifacts) {
    await copyFile(
      join(inputArtifactsDirectory, artifact.file),
      join(artifactsDirectory, artifact.file),
    );
  }
}

async function verifyTarballs() {
  const expectedFiles = new Map([
    [
      "@flowview/compiler",
      [
        "package/package.json",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/pkg/package.json",
        "package/pkg/flowview_wasm.js",
        "package/pkg/flowview_wasm.d.ts",
        "package/pkg/flowview_wasm_bg.wasm.d.ts",
        "package/pkg/flowview_wasm_bg.wasm",
      ],
    ],
    [
      "@flowview/runtime",
      [
        "package/package.json",
        "package/dist/index.js",
        "package/dist/index.d.ts",
      ],
    ],
    [
      "@flowview/vite",
      [
        "package/package.json",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/client.d.ts",
      ],
    ],
  ]);

  for (const artifact of artifactManifest.artifacts) {
    const tarball = join(artifactsDirectory, artifact.file);
    const bytes = await readFile(tarball);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    if (integrity !== artifact.integrity) {
      throw new Error(`Integrity mismatch for ${artifact.file}`);
    }
    const entries = new Set(
      run("tar", ["-tzf", tarball], { capture: true }).trim().split(/\r?\n/),
    );
    const requiredFiles = expectedFiles.get(artifact.name) ?? [
      "package/package.json",
    ];
    for (const entry of requiredFiles) {
      if (!entries.has(entry)) {
        throw new Error(`${artifact.name} tarball is missing ${entry}`);
      }
    }
    const manifestText = run(
      "tar",
      ["-xOzf", tarball, "package/package.json"],
      { capture: true },
    );
    const manifest = JSON.parse(manifestText);
    packedManifestByName.set(artifact.name, manifest);
    if (
      manifest.name !== artifact.name ||
      manifest.version !== artifact.version
    ) {
      throw new Error(
        `Tarball metadata mismatch for ${artifact.name}: ${manifest.name}@${manifest.version}`,
      );
    }
    for (const section of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const [dependency, version] of Object.entries(
        manifest[section] ?? {},
      )) {
        if (typeof version === "string" && version.startsWith("workspace:")) {
          throw new Error(
            `${artifact.name} packed ${section}.${dependency} as ${version}`,
          );
        }
        if (
          dependency.startsWith("@flowview/") &&
          !artifactByName.has(dependency)
        ) {
          throw new Error(
            `${artifact.name} depends on ${dependency}, but no matching tarball was packed`,
          );
        }
      }
    }
    verifyExportTargets(artifact.name, manifest, entries);
    console.log(
      `Verified tarball contents and manifest: ${artifact.name}@${artifact.version}`,
    );
  }
}

async function createConsumerProject() {
  const [physicalConsumerRoot, physicalArtifactsDirectory] = await Promise.all([
    realpath(consumerRoot),
    realpath(artifactsDirectory),
  ]);
  const dependencies = Object.fromEntries(
    artifactManifest.artifacts.map((artifact) => [
      artifact.name,
      `file:${relative(physicalConsumerRoot, join(physicalArtifactsDirectory, artifact.file)).split(sep).join("/")}`,
    ]),
  );
  const project = {
    name: "flowview-packed-consumer",
    private: true,
    type: "module",
    pnpm: { overrides: dependencies },
    scripts: { build: "vite build", typecheck: "tsc --noEmit" },
    dependencies: { ...dependencies, vite: "^8.0.0" },
    devDependencies: {
      "@jridgewell/trace-mapping": "^0.3.31",
      typescript: "^5.9.0",
    },
  };
  await writeFile(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(project, null, 2)}\n`,
  );
  await writeConsumerSources();
  return project;
}

async function writeConsumerSources() {
  await mkdir(join(consumerRoot, "src"), { recursive: true });
  await writeFile(
    join(consumerRoot, "index.html"),
    `<!doctype html>
<html><head><meta charset="UTF-8"><title>Packed FlowView</title></head>
<body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
  );
  await writeFile(
    join(consumerRoot, "src/page.flow"),
    `<main>
  <h1>{{ context.title }}</h1>
  @if (context.visible) {
    <ul>
      @for (item of context.items; track item.name) {
        <li>{{ item.name }}</li>
      } @empty {
        <li>Empty</li>
      }
    </ul>
  }
</main>
`,
  );
  await writeFile(
    join(consumerRoot, "src/main.ts"),
    `import { render } from "./page.flow";

export const html = render({
  title: "<FlowView & packed>",
  visible: true,
  items: [{ name: "<Packed & local>" }],
});
`,
  );
  await writeFile(
    join(consumerRoot, "vite.config.mjs"),
    `import { defineConfig } from "vite";
import flowview from "@flowview/vite";

export default defineConfig({ plugins: [flowview()] });
`,
  );
  await writeFile(
    join(consumerRoot, "env.d.ts"),
    `/// <reference types="@flowview/vite/client" />
`,
  );
  await writeFile(
    join(consumerRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["env.d.ts", "src/**/*.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerRoot, "verify-installed.mjs"),
    verificationModule,
  );
}

async function installDependencies() {
  removeRustToolDirectoriesFromPath();
  for (const executable of ["cargo", "rustc", "wasm-pack"]) {
    if (findOnPath(executable)) {
      throw new Error(
        `Rust tool ${executable} is still available in the consumer PATH`,
      );
    }
  }
  delete process.env.FLOWVIEW_COMPILER_PATH;
  runPnpm(["install", "--no-frozen-lockfile", "--store-dir", storeDirectory]);
}

async function verifyInstalledPackages(project) {
  for (const artifact of artifactManifest.artifacts) {
    const installedManifestPath = join(
      consumerRoot,
      "node_modules",
      ...artifact.name.split("/"),
      "package.json",
    );
    const installedManifest = JSON.parse(
      await readFile(installedManifestPath, "utf8"),
    );
    if (installedManifest.version !== artifact.version) {
      throw new Error(
        `${artifact.name} resolved to ${installedManifest.version}; expected local tarball ${artifact.version}`,
      );
    }
    const dependencySpec = project.dependencies[artifact.name];
    if (!dependencySpec?.startsWith("file:")) {
      throw new Error(
        `${artifact.name} is not installed from a local packed tarball`,
      );
    }
  }

  const installedRoot = await realpath(join(consumerRoot, "node_modules"));
  const packagePaths = await runNodeModule("verify-installed.mjs", [
    "--resolve-only",
  ]);
  for (const [name, resolvedUrl] of Object.entries(packagePaths.resolved)) {
    const resolvedPath = await realpath(fileURLToPath(resolvedUrl));
    if (!isWithin(installedRoot, resolvedPath)) {
      throw new Error(
        `${name} resolved outside consumer node_modules: ${resolvedPath}`,
      );
    }
    if (resolvedPath.includes(repositoryRoot)) {
      throw new Error(
        `${name} leaked from the Flowview checkout: ${resolvedPath}`,
      );
    }
  }
  for (const [parentName, manifest] of packedManifestByName) {
    const parentUrl = packagePaths.resolved[parentName];
    const parentEntry = await realpath(fileURLToPath(parentUrl));
    const parentPackageRoot = dirname(dirname(parentEntry));
    for (const section of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const dependencyName of Object.keys(manifest[section] ?? {})) {
        if (!dependencyName.startsWith("@flowview/")) continue;
        const dependencyArtifact = artifactByName.get(dependencyName);
        if (!dependencyArtifact) {
          throw new Error(
            `${parentName} requires unpacked dependency ${dependencyName}`,
          );
        }
        const dependencyManifest = await findPackageManifest(
          parentPackageRoot,
          dependencyName,
        );
        if (!dependencyManifest) {
          throw new Error(
            `Could not resolve ${dependencyName} from installed ${parentName}`,
          );
        }
        const actualDependencyRoot = await realpath(
          dirname(dependencyManifest),
        );
        const expectedDependencyRoot = dirname(
          dirname(
            await realpath(
              fileURLToPath(packagePaths.resolved[dependencyName]),
            ),
          ),
        );
        if (actualDependencyRoot !== expectedDependencyRoot) {
          throw new Error(
            `${parentName} resolves ${dependencyName} outside its local tarball: ${actualDependencyRoot}`,
          );
        }
      }
    }
  }
  console.log(
    "All Flowview imports resolve inside the external project's node_modules",
  );
}

async function verifyCompiler() {
  const result = await runNodeModule("verify-installed.mjs", ["--compiler"]);
  if (!result.compilerCode.includes("export function render")) {
    throw new Error("Packed compiler did not generate a render function");
  }
  if (
    !result.warning.some(
      (item) =>
        item.severity === "warning" &&
        item.message.toLowerCase().includes("track"),
    )
  ) {
    throw new Error(
      "Packed compiler warning contract did not return the expected track warning",
    );
  }
  if (
    !result.compilerMap ||
    result.compilerMap.version !== 3 ||
    !result.compilerMap.sources.includes("page.flow") ||
    result.compilerMappingCount < 1
  ) {
    throw new Error(
      "Packed compiler did not return a decodable page.flow source map",
    );
  }
  console.log(
    "Packed WASM compiler generated JavaScript, warning diagnostics, and a source map",
  );
}

async function verifyDevelopmentPipeline() {
  const result = await runNodeModule("verify-installed.mjs", ["--dev"]);
  for (const fragment of [
    "&lt;FlowView &amp; packed&gt;",
    "&lt;Packed &amp; local&gt;",
  ]) {
    if (!result.html.includes(fragment)) {
      throw new Error(
        `Vite dev execution did not render escaped output: ${fragment}`,
      );
    }
  }
  if (
    !result.devMapSources.some((source) => source.endsWith("page.flow")) ||
    result.devMappingCount < 1
  ) {
    throw new Error(
      "Vite dev transform did not retain a decodable .flow source map",
    );
  }
  console.log(
    "Vite dev transform and SSR execution passed with escaped output and source mapping",
  );
}

async function verifyProductionBuild() {
  const buildResult = await runNodeModule("verify-installed.mjs", ["--build"]);
  if (buildResult.productionBuild !== true) {
    throw new Error(
      "Vite production build was not executed by the consumer probe",
    );
  }
  const distDirectory = join(consumerRoot, "dist");
  const assetsDirectory = join(distDirectory, "assets");
  const assets = await readdir(assetsDirectory, { withFileTypes: true });
  const javascriptAssets = assets.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".js"),
  );
  if (javascriptAssets.length === 0)
    throw new Error("Vite production build emitted no JS bundle");

  for (const asset of javascriptAssets) {
    const content = await readFile(join(assetsDirectory, asset.name), "utf8");
    if (
      !content.includes("<main") ||
      !content.includes("<h1") ||
      !content.includes("FlowView & packed") ||
      !content.includes("Packed & local")
    ) {
      throw new Error(
        "Production bundle does not contain compiled template markup and render context",
      );
    }
    if (
      /from\s*["']@flowview\//.test(content) ||
      /import\s*["']@flowview\//.test(content)
    ) {
      throw new Error(
        `Production bundle contains an unresolved Flowview import: ${asset.name}`,
      );
    }
    if (content.includes(repositoryRoot)) {
      throw new Error(
        `Production bundle embeds a path into the Flowview checkout: ${asset.name}`,
      );
    }
  }
  console.log("Vite production build emitted a self-contained Flowview bundle");
}

async function verifyTypes() {
  runPnpm(["exec", "tsc", "--noEmit"]);
  console.log(
    "TypeScript resolved the published @flowview/vite/client .flow declaration",
  );
}

async function runNodeModule(moduleName, args) {
  const output = run(process.execPath, [moduleName, ...args], {
    cwd: consumerRoot,
    capture: true,
    env: { ...process.env, FLOWVIEW_COMPILER_PATH: undefined },
  });
  try {
    const lastLine = output.trim().split(/\r?\n/).at(-1);
    return JSON.parse(lastLine);
  } catch (error) {
    throw new Error(
      `Consumer probe did not return JSON: ${output}\n${String(error)}`,
    );
  }
}

function runPnpm(args) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  run(executable, args, {
    cwd: consumerRoot,
    env: { ...process.env, FLOWVIEW_COMPILER_PATH: undefined },
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
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

function removeRustToolDirectoriesFromPath() {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const filtered = pathEntries.filter(
    (entry) =>
      !["cargo", "rustc", "wasm-pack"].some((tool) => pathHasTool(entry, tool)),
  );
  process.env.PATH = filtered.join(delimiter);
}

function pathHasTool(directory, tool) {
  const extensions =
    process.platform === "win32"
      ? [
          "",
          ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
            .split(";")
            .map((value) => value.toLowerCase()),
        ]
      : [""];
  return extensions.some((extension) => {
    return existsSync(join(directory, `${tool}${extension}`));
  });
}

function findOnPath(tool) {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    const extensions =
      process.platform === "win32"
        ? [
            "",
            ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
              .split(";")
              .map((value) => value.toLowerCase()),
          ]
        : [""];
    for (const extension of extensions) {
      const candidate = resolve(directory, `${tool}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..")
  );
}

async function findPackageManifest(fromDirectory, packageName) {
  let directory = fromDirectory;
  const packagePath = packageName.split("/");
  while (true) {
    const candidate = join(
      directory,
      "node_modules",
      ...packagePath,
      "package.json",
    );
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function verifyExportTargets(packageName, manifest, entries) {
  for (const target of collectExportTargets(manifest.exports)) {
    const tarEntry = `package/${target.replace(/^\.\//, "")}`;
    if (!entries.has(tarEntry)) {
      throw new Error(
        `${packageName} exports ${target}, but the tarball lacks ${tarEntry}`,
      );
    }
  }
}

function collectExportTargets(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectExportTargets);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(collectExportTargets);
  return [];
}

const verificationModule = `import { compileFlowview } from "@flowview/compiler";
import { eachMapping, TraceMap } from "@jridgewell/trace-mapping";
import { build, createServer } from "vite";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import childProcess from "node:child_process";

delete process.env.FLOWVIEW_COMPILER_PATH;
installNativeProcessGuard();
const projectRoot = realpathSync.native(process.cwd());
const packageNames = ["@flowview/compiler", "@flowview/runtime", "@flowview/vite"];
const resolved = Object.fromEntries(packageNames.map((name) => [name, import.meta.resolve(name)]));
const args = new Set(process.argv.slice(2));
const output = { resolved };

if (args.has("--compiler")) {
  const compileResult = compileFlowview(
    "@for (item of context.items; track item.id) { <p>{{ item.name }}</p> }",
    { filename: "page.flow", sourceMap: true },
  );
  const traceMap = new TraceMap(compileResult.map);
  let compilerMappingCount = 0;
  eachMapping(traceMap, () => { compilerMappingCount += 1; });
  output.compilerCode = compileResult.code;
  output.warning = compileResult.warnings;
  output.compilerMap = compileResult.map;
  output.compilerMappingCount = compilerMappingCount;
}

if (args.has("--dev")) {
  const server = await createServer({
    configFile: resolve(projectRoot, "vite.config.mjs"),
    root: projectRoot,
    appType: "custom",
    server: { middlewareMode: true },
    logLevel: "silent",
  });
  try {
    const transformed = await server.transformRequest("/src/page.flow");
    if (!transformed?.code || !transformed.code.includes("export function render")) {
      throw new Error("Vite development pipeline did not transform page.flow");
    }
    if (!transformed.map) throw new Error("Vite development transform omitted its source map");
    const traceMap = new TraceMap(transformed.map);
    let devMappingCount = 0;
    eachMapping(traceMap, () => { devMappingCount += 1; });
    output.devMapSources = traceMap.sources;
    output.devMappingCount = devMappingCount;
    const main = await server.ssrLoadModule("/src/main.ts");
    output.html = main.html;
  } finally {
    await server.close();
  }
}

if (args.has("--build")) {
  await build({
    configFile: resolve(projectRoot, "vite.config.mjs"),
    root: projectRoot,
  });
  output.productionBuild = true;
}

if (args.has("--resolve-only")) {
  // The import map above is the resolution evidence; do not run Vite here.
}

console.log(JSON.stringify(output));

function installNativeProcessGuard() {
  const blockedTools = new Set(["flowview", "cargo", "rustc", "wasm-pack"]);
  const blocked = (command) => {
    const executable = String(command)
      .split(/[\\/]/)
      .pop()
      .toLowerCase()
      .replace(/\\.exe$/, "");
    if (blockedTools.has(executable)) {
      throw new Error("Native FlowView/Rust process spawn blocked: " + command);
    }
  };
  for (const method of [
    "spawn",
    "spawnSync",
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "fork",
  ]) {
    const original = childProcess[method];
    childProcess[method] = function (command, ...rest) {
      blocked(command);
      return original.call(this, command, ...rest);
    };
  }
  syncBuiltinESMExports();
}
`;

await main();
