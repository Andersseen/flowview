# S1 — Public API contracts and compatibility

**Status:** implementation candidate; S remains active. RC has not started and
this record does not claim S exit or API freeze.

## Candidate and scope

- Inspected `origin/main` base: `c4c86d01d22421b24f30fc3ab0989d703f12d9f6`
  (2026-10-24). This matched the supplied baseline after `git fetch origin
--prune`; there was no S1 implementation or open PR at inspection.
- Rust versions: `flowview-compiler`, CLI, and WASM wrapper `0.3.0`;
  `flowview-static-runtime 0.1.0`.
- npm versions at the audited build: runtime `0.2.1`, compiler `0.2.4`, DOM
  `0.3.0`, reactive `0.1.1`, Events `0.2.0`, Vite `0.1.4`, Vite Events
  `0.1.2`, Astro `0.1.5`, Astro Events `1.0.0`, Prettier `0.1.3`; VS Code
  extension `0.2.0`.
- Affected surfaces: published npm import/type verification and CI, package
  installation guidance, current phase/release docs, and the Rust/npm contract
  inventory. No shipped package API or artifact representation changed.

## Contract findings

- **PASS — API inventory:** [`public-api-contract.md`](../public-api-contract.md)
  maps Rust crates, CLI, package entry points, browser ownership limits,
  diagnostics, version pairings, and post-1.0 SemVer. It derives exports from
  crate roots, `exports` maps and CLI argument definitions.
- **P2 — Rust exposure risk (documented):** `flowview_compiler` currently
  exposes `ast`, `parser`, `codegen`, and `static_html` modules publicly.
  These implementation-oriented modules are Rust public API today. They remain
  visible; narrowing them needs migration and release review.
- **PASS — AOT relationship:** artifact format version 1 is distinct from
  compiler package version; metadata records compiler version but runtime
  decoding does not require exact compiler/runtime version equality. `--check`
  verifies canonical bytes for the selected compiler. No AOT schema changed.
- **PASS — Compatibility source:** `scripts/compatibility.json` matches the
  declared Node 22.12 floor, Vite 6–8, Astro 5–7, and Prettier 3. Compiler/CLI
  MSRV is 1.91; standalone runtime MSRV is 1.85. Astro 7's upstream engine floor
  is higher than Node 22.12 and is tested separately with Node 24.
- **PASS — Distribution pairing:** `flowview-wasm` is `publish = false` and is
  bundled into `@flowview/compiler`; Rust and npm versions are independently
  versioned. Browser runtime packages can be installed without Rust.
- **PASS — diagnostics:** Rust diagnostic offsets are UTF-8 byte offsets;
  editor-facing VS Code code maps bytes to UTF-16. Existing CLI JSON and compiler
  tests cover the documented fields/codes. Static diagnostics preserve source
  spans; static output does not promise JavaScript source maps.
- **PASS — browser semantics:** existing DOM and E2E tests cover root ownership,
  deliberate HTML replacement, scoped refs, explicit bindings and disposal.
  Reactive APIs are optional. Events registration is explicit and uses native
  delegated listeners. No browser behavior changes were needed.
- **P2 — Hono E2E local run:** `pnpm test:e2e:hono-demo` reused an existing
  Astro preview listening on `127.0.0.1:4322` because
  `examples/hono-demo/playwright.config.ts` enables reuse outside CI. The four
  tests therefore saw the Astro home page instead of Hono content and failed
  to find `Buy milk`/Hono controls. `lsof -nP -iTCP:4322 -sTCP:LISTEN` identified
  PID 21158 as `astro preview --port 4322`; the process was left running. This
  needs a clean hosted CI result; it is not evidence of a source regression.

## Implementation and docs

- Added `scripts/verify-packed-public-exports.mjs`. It consumes the exact packed
  tarballs from a fresh temporary project, checks packed lockfile identity,
  imports and executes runtime/compiler/DOM/reactive/Events ESM entry points
  plus `@flowview/events/runtime`, checks generated ESM module shape, removes
  Rust from `PATH`, and typechecks representative public imports under
  TypeScript `NodeNext` and `Bundler` resolution.
- Added `verify:packed-public-exports` and wired the check into
  `.github/workflows/release-readiness.yml`, next to existing tarball validation.
  Vite/Astro `.flow` declarations and Prettier host integrations remain covered
  by their existing external consumers.
- Added the package/crate choice and installation map, Rust public-module
  exposure assessment, compatibility/semver policy, generated JS/AOT pairing,
  and DOM/Events boundaries to the public inventory.
- Corrected the README's current phase to S stabilization, aligned
  `RELEASE.md` with equal JS and Rust distribution tracks, replaced its stale
  checkout path, and refreshed the SDD's current audit baseline while retaining
  the historical 2026-10-22 record.
- **Version decision:** no Changeset or Rust version bump. Changes are
  documentation and repository-only verification; published behavior and APIs
  are unchanged. No package was published.

## Local verification

| Result                       | Evidence                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PASS**                     | `CI=true pnpm install --frozen-lockfile --store-dir /private/tmp/flowview-pnpm-store`                                                                                                                                        |
| **PASS**                     | `cargo fmt --all -- --check`; strict workspace Clippy; `cargo test --workspace --locked`; rustdoc with `RUSTDOCFLAGS='-D warnings'`; `cargo package --workspace --exclude flowview-wasm --locked --no-verify --offline`      |
| **PASS**                     | `cargo +1.91.0 test --workspace --locked`; `cargo +1.85.0 test -p flowview-static-runtime --locked`; `scripts/verify-aot-packaged-consumer.sh`                                                                               |
| **PASS**                     | `pnpm format:check`, `pnpm typecheck`, `pnpm test:spec` (130/130), `pnpm check:compatibility`, `pnpm test`, `pnpm build`, `pnpm lint`                                                                                        |
| **PASS**                     | `pnpm test:e2e:demo` (37 passed); `pnpm build:demo`; `pnpm test:e2e:acceptance` (18 passed)                                                                                                                                  |
| **FAIL — harness collision** | `pnpm test:e2e:hono-demo` (4 failed after reusing the existing Astro preview on port 4322; see P2 reproduction above)                                                                                                        |
| **PASS**                     | Packed artifact validation: 10 tarballs, entry target checks and npm publish dry-runs. `npm_config_cache=/private/tmp/flowview-npm-cache` was needed because the default user npm cache has root-owned files.                |
| **PASS**                     | New packed public-export/type check; runtime/compiler/DOM/reactive/Events imports and declarations passed with NodeNext and Bundler.                                                                                         |
| **PASS**                     | Packed Vite consumers: 6 (`6.4.5`), 7 (`7.3.7`), 8 (`8.3.5`).                                                                                                                                                                |
| **PASS**                     | Packed Astro consumers: 5 (`5.18.2`), 6 (`6.4.8`), 7 (`7.4.2`, Node `24.22.1`).                                                                                                                                              |
| **PASS**                     | Packed Prettier: floor `3.0.0`, latest 3.x `3.9.10`.                                                                                                                                                                         |
| **PASS**                     | Node 22.12.0 packed consumers: Vite 8, Astro 6, Prettier latest 3.x. Node 24 was used for Astro 7 per its engine floor.                                                                                                      |
| **PASS**                     | `scripts/publish-rust.sh --dry-run`: runtime Cargo dry-run passed. Compiler and CLI report `NOT EXECUTED` because their exact prerequisite versions are not published to crates.io. No upload occurred.                      |
| **PASS**                     | Local bounded fuzz replay of checked-in corpus plus retained crash inputs: `cargo +nightly fuzz run compiler <temp-corpus> -- -runs=100 -max_len=8192 -timeout=10 -rss_limit_mb=4096`; 96 initial files, 100 runs, no crash. |
| **NOT EXECUTED**             | The CI-only 75-second smoke / scheduled 600-second hosted fuzz runs and Linux/Windows npm/Rust portability matrices. These require hosted runners.                                                                           |

The first release-artifact validation attempt used the broken default npm cache
and failed with `EPERM`; it passed after setting `npm_config_cache` to the
writable temporary cache. A first `cargo package` attempt required crates.io
metadata and failed on DNS; the same package command passed offline. These are
environment constraints, not green results attributed to the failed attempts.

## Hosted CI and disposition

| Check                                                                                 | Result at candidate preparation                                                         |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GitHub Actions on this PR HEAD                                                        | **NOT EXECUTED** until the branch is pushed and PR opened.                              |
| CI / Spec conformance, Rust, MSRV, portability, release readiness, browser acceptance | **NOT EXECUTED** on this candidate. CI must confirm the Hono suite on its clean runner. |
| Publication                                                                           | **NOT APPLICABLE**; no publication requested or performed.                              |

No P0/P1 defect was discovered in the audited existing contracts. P2 items are
the documented Rust module visibility risk and the local Hono test-port reuse
collision. P3 items are follow-up clarity and tooling concerns already captured
in current support docs.

Deferred to later S work: broad browser security review, Events source-map
attribution and source attribution edge cases, platform-specific consumer
matrices on hosted runners, review/acceptance of public-module visibility,
remaining support/install docs and full RC entry evidence. S remains active;
RC remains blocked until its complete entry contract passes and maintainers
accept the freeze.
