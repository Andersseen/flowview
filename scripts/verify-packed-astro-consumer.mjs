// External Astro consumer: installs the packed tarballs next to a given Astro
// major in a fresh project, builds it, and asserts the generated site.
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage =
  "Usage: node scripts/verify-packed-astro-consumer.mjs <packed-artifact-directory> [--astro <major>]";
const positional = [];
let astroMajor = "7";
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--astro") astroMajor = process.argv[++index] ?? "";
  else positional.push(argument);
}
if (positional.length !== 1 || !/^\d+$/.test(astroMajor))
  throw new Error(usage);

const artifactSet = await loadArtifactSet(positional[0]);
const closureNames = internalClosure(artifactSet, [
  "@flowview/astro",
  "@flowview/astro-events",
]);
for (const required of [
  "@flowview/astro",
  "@flowview/astro-events",
  "@flowview/vite",
  "@flowview/vite-events",
  "@flowview/events",
  "@flowview/compiler",
  "@flowview/runtime",
]) {
  if (!closureNames.includes(required))
    throw new Error(`The Astro consumer graph does not include ${required}`);
}
const artifacts = closureNames.map((name) => artifactSet.byName.get(name));

const temporaryRoot = await mkdtemp(
  join(tmpdir(), `flowview-packed-astro${astroMajor}-`),
);
const consumerRoot = join(temporaryRoot, "consumer");
const artifactsDirectory = join(temporaryRoot, "packed-artifacts");
const storeDirectory = join(temporaryRoot, "pnpm-store");
let keepTemporaryFiles = false;

try {
  await mkdir(consumerRoot, { recursive: true });
  await stageTarballs();
  await writeProject();
  removeRustFromPath();
  runPnpm(["install", "--no-frozen-lockfile", "--store-dir", storeDirectory]);
  await assertLockfileUsesPackedTarballs(
    consumerRoot,
    artifactSet,
    closureNames,
  );
  await verifyAstroMajor();
  runPnpm(["exec", "astro", "build"]);
  await verifyBuiltSite();
  runPnpm(["exec", "astro", "check", "--minimumSeverity", "warning"]);
  console.log(
    `Packed Astro ${astroMajor} consumer passed on ${process.platform} in ${consumerRoot}`,
  );
} catch (error) {
  keepTemporaryFiles = true;
  console.error(
    `Packed Astro ${astroMajor} consumer failed. Project preserved at ${consumerRoot}`,
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

async function stageTarballs() {
  await mkdir(artifactsDirectory, { recursive: true });
  for (const artifact of artifacts) {
    await verifyIntegrity(artifactSet, artifact);
    await copyFile(
      tarballPath(artifactSet, artifact),
      join(artifactsDirectory, artifact.file),
    );
  }
}

async function writeProject() {
  const [physicalConsumerRoot, physicalArtifactsDirectory] = await Promise.all([
    realpath(consumerRoot),
    realpath(artifactsDirectory),
  ]);
  const dependencies = Object.fromEntries(
    artifacts.map((artifact) => [
      artifact.name,
      `file:${relative(physicalConsumerRoot, join(physicalArtifactsDirectory, artifact.file)).split(sep).join("/")}`,
    ]),
  );
  const project = {
    name: `flowview-packed-astro${astroMajor}-consumer`,
    private: true,
    type: "module",
    pnpm: { overrides: dependencies },
    dependencies: { ...dependencies, astro: `^${astroMajor}.0.0` },
    devDependencies: {
      "@astrojs/check": "^0.9.0",
      typescript: "^5.9.0",
    },
  };
  await write("package.json", `${JSON.stringify(project, null, 2)}\n`);
  await write(
    "astro.config.mjs",
    `import { defineConfig } from "astro/config";
import flowview from "@flowview/astro";
import flowviewEvents from "@flowview/astro-events";

export default defineConfig({ integrations: [flowviewEvents(), flowview()] });
`,
  );
  await write(
    "tsconfig.json",
    `${JSON.stringify({ extends: "astro/tsconfigs/strict", include: [".astro/types.d.ts", "src/**/*"] }, null, 2)}\n`,
  );
  await write(
    "src/env.d.ts",
    `/// <reference path="../.astro/types.d.ts" />
/// <reference types="@flowview/vite/client" />
declare module "virtual:flowview-events/*" {}
`,
  );
  await write(
    "src/views/list.flow",
    `<ul id="standalone">
  @for (item of context.items; track item.name) {
    <li>{{ item.name }}</li>
  } @empty {
    <li>Empty</li>
  }
</ul>
`,
  );
  await write(
    "src/pages/index.astro",
    `---
import { render } from "../views/list.flow";

const context = {
  title: "<Inline & packed>",
  visible: true,
  items: [{ name: "<One & only>" }],
};
const standalone = render(context);
---

<html lang="en">
  <head><meta charset="utf-8" /><title>Packed Astro</title></head>
  <body>
    <template flowview={context} is:raw>
      <h1 id="inline">{{ context.title }}</h1>
      @if (context.visible) {
        <ul id="embedded">
          @for (item of context.items; track item.name) {
            <li>{{ item.name }}</li>
          } @empty {
            <li>Empty</li>
          }
        </ul>
      } @else {
        <p id="hidden">Hidden</p>
      }
    </template>
    <Fragment set:html={standalone} />
  </body>
</html>
`,
  );
  await write(
    "src/pages/events.astro",
    `---
---

<html lang="en">
  <head><meta charset="utf-8" /><title>Packed Astro Events</title></head>
  <body>
    <button (click)="save()">Save</button>

    <script data-flowview>
      function save() {}
    </script>
  </body>
</html>
`,
  );
}

async function write(file, content) {
  const target = join(consumerRoot, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function verifyAstroMajor() {
  const installed = JSON.parse(
    await readFile(
      join(consumerRoot, "node_modules/astro/package.json"),
      "utf8",
    ),
  );
  if (installed.version.split(".")[0] !== astroMajor) {
    throw new Error(
      `Expected Astro ${astroMajor}, installed ${installed.version}`,
    );
  }
  console.log(`Consumer is running Astro ${installed.version}`);
}

async function verifyBuiltSite() {
  const index = await readFile(join(consumerRoot, "dist/index.html"), "utf8");
  for (const fragment of [
    '<h1 id="inline">&lt;Inline &amp; packed&gt;</h1>',
    '<ul id="embedded">',
    "<li>&lt;One &amp; only&gt;</li>",
    '<ul id="standalone">',
  ]) {
    if (!index.includes(fragment)) {
      throw new Error(`dist/index.html is missing ${fragment}\n${index}`);
    }
  }
  for (const forbidden of [
    "{{",
    "@for",
    "@if",
    "<template",
    "Hidden",
    "<One &",
  ]) {
    if (index.includes(forbidden)) {
      throw new Error(`dist/index.html unexpectedly contains ${forbidden}`);
    }
  }
  if (index.includes(repositoryRoot)) {
    throw new Error("dist/index.html references the Flowview checkout");
  }

  const events = await readFile(
    join(consumerRoot, "dist/events/index.html"),
    "utf8",
  );
  for (const fragment of ["data-flow-on-click=", "data-flow-scope="]) {
    if (!events.includes(fragment)) {
      throw new Error(
        `dist/events/index.html is missing ${fragment}\n${events}`,
      );
    }
  }
  if (/<script[^>]*data-flowview/.test(events) || events.includes("(click)")) {
    throw new Error(
      "dist/events/index.html still contains Events authoring syntax",
    );
  }
  console.log(
    "Astro build rendered inline + standalone templates (escaped) and Events attributes",
  );
}

function runPnpm(args) {
  run(pnpmExecutable(), args, {
    cwd: consumerRoot,
    env: { ...process.env, FLOWVIEW_COMPILER_PATH: undefined },
  });
}
