// Exercise the independently usable JavaScript libraries from their packed
// tarballs. Integration packages have dedicated Vite/Astro/Prettier consumers.
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  assertLockfileUsesPackedTarballs,
  loadArtifactSet,
  pnpmExecutable,
  removeRustFromPath,
  run,
  tarballPath,
  verifyIntegrity,
} from "./lib/packed-artifacts.mjs";

const [artifactDirectory] = process.argv.slice(2);
if (!artifactDirectory || process.argv.length !== 3) {
  throw new Error(
    "Usage: node scripts/verify-packed-public-exports.mjs <packed-artifact-directory>",
  );
}

const packageNames = [
  "@flowview/runtime",
  "@flowview/compiler",
  "@flowview/dom",
  "@flowview/reactive",
  "@flowview/events",
];
const artifactSet = await loadArtifactSet(artifactDirectory);
const artifacts = packageNames.map((name) => {
  const artifact = artifactSet.byName.get(name);
  if (!artifact) throw new Error(`Missing packed artifact for ${name}`);
  return artifact;
});
const temporaryRoot = await mkdtemp(join(tmpdir(), "flowview-public-exports-"));
const consumerRoot = join(temporaryRoot, "consumer");
const artifactsDirectory = join(temporaryRoot, "artifacts");
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
    `${JSON.stringify(
      {
        name: "flowview-packed-public-exports-consumer",
        private: true,
        type: "module",
        pnpm: { overrides: dependencies },
        dependencies: { ...dependencies, typescript: "^5.9.0" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerRoot, "consumer.mjs"),
    `import { escapeHtml, renderValue } from "@flowview/runtime";
import { compileFlowview, FlowviewCompilerError } from "@flowview/compiler";
import { createView } from "@flowview/dom";
import { signal, computed, effect, untracked } from "@flowview/reactive";
import { findEventBindings, hashScope } from "@flowview/events";
import { registerFlowHandlers } from "@flowview/events/runtime";

if (escapeHtml("<tag>") !== "&lt;tag&gt;") throw new Error("runtime root export failed");
if (renderValue("x&") !== "x&amp;") throw new Error("runtime helper export failed");
const compiled = compileFlowview("<p>{{ context.name }}</p>");
if (!compiled.code.startsWith("import ") || !compiled.code.includes("export function render")) {
  throw new Error("compiler did not emit its declared ESM render module");
}
if (typeof FlowviewCompilerError !== "function" || typeof createView !== "function") {
  throw new Error("compiler or DOM public root export failed");
}
const count = signal(1);
const doubled = computed(() => count() * 2);
if (doubled() !== 2 || untracked(() => doubled()) !== 2) {
  throw new Error("reactive root exports failed");
}
let observed = 0;
const stop = effect(() => { observed = count(); });
count.set(2);
stop();
if (observed !== 2) throw new Error("reactive effect export failed");
if (findEventBindings('<button (click)="save()">x</button>').length !== 1) {
  throw new Error("Events root export failed");
}
if (!hashScope("page.flow") || typeof registerFlowHandlers !== "function") {
  throw new Error("Events runtime subpath export failed");
}
console.log("Packed FlowView public JavaScript exports passed");
`,
  );
  await writeFile(
    join(consumerRoot, "consumer.mts"),
    `import { escapeHtml, type RenderContext, type RenderFunction } from "@flowview/runtime";
import { compileFlowview, type FlowviewCompilerOptions, type FlowviewCompilerResult } from "@flowview/compiler";
import { createView, type FlowviewView, type FlowviewValueSource } from "@flowview/dom";
import { signal, computed, effect, untracked, type Signal } from "@flowview/reactive";
import { findEventBindings, type EventBinding } from "@flowview/events";
import { registerFlowHandlers, type FlowEventHandlers } from "@flowview/events/runtime";

const context: RenderContext = { name: "Ada" };
const render: RenderFunction = (value) => escapeHtml(String(value.name));
const options: FlowviewCompilerOptions = { filename: "page.flow" };
const result: FlowviewCompilerResult = compileFlowview("<p>x</p>", options);
const bindings: EventBinding[] = findEventBindings('<button (click)="save()"></button>');
const source: Signal<number> = signal(1);
const current: number = computed(() => source()).peek();
const stop: () => void = effect(() => { source(); });
const raw: number = untracked(() => source());
const handlers: FlowEventHandlers = { save: () => undefined };
const unbind: () => void = registerFlowHandlers("scope", handlers, ["click"]);
declare const view: FlowviewView<RenderContext>;
declare const valueSource: FlowviewValueSource<RenderContext>;
view.bind(valueSource);
const create: typeof createView<RenderContext> = createView;
void [context, render, result, bindings, current, raw, stop, unbind, create];
`,
  );
  await writeFile(
    join(consumerRoot, "tsconfig.node.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        skipLibCheck: false,
      },
      files: ["consumer.mts"],
    }),
  );
  await writeFile(
    join(consumerRoot, "tsconfig.bundler.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: false,
      },
      files: ["consumer.mts"],
    }),
  );

  removeRustFromPath();
  run(
    pnpmExecutable(),
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
    packageNames,
  );
  run(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--project", "tsconfig.node.json"],
    { cwd: consumerRoot },
  );
  run(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--project", "tsconfig.bundler.json"],
    { cwd: consumerRoot },
  );
  run(process.execPath, ["consumer.mjs"], { cwd: consumerRoot });
  console.log(
    "Packed FlowView declarations resolved with NodeNext and Bundler",
  );
} catch (error) {
  keep = true;
  console.error(
    `Packed public export consumer failed. Project preserved at ${consumerRoot}`,
  );
  throw error;
} finally {
  if (!keep && process.env.FLOWVIEW_KEEP_PACKED_CONSUMER !== "1") {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
