# FlowView RC and 1.0 contract

## Authority and evidence

`1.0.0-rc.1` means the [v1 roadmap](v1-roadmap.md) outcomes are implemented,
all public design decisions are closed, and the release candidate is fit for
external validation. It is not a feature preview. The [normative spec](flowview-spec.md)
still describes shipped behavior. These rules override permission for future
roadmap work once RC starts; stabilization already prohibits new outcomes.

Nothing in this document claims these gates have passed today. Existing workflows
cover much of the baseline; new editor, composition, forms and AOT acceptance must
be added by their owning milestones. A successful workflow that omits a required
suite is not equivalent to passing that suite.

The release owner maintains an RC evidence ledger in the release PR with:

| Required field    | Meaning                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Candidate         | Exact commit, package/crate versions, compiler/runtime/editor pairings                          |
| Artifact identity | npm tarball hashes/content comparison, crate checksums, VSIX and AOT generator/runtime versions |
| Gate result       | Command or workflow/job URL, platform/toolchain, result and date                                |
| Consumer evidence | Consumer revision, install source, supported scenario, result and limitations                   |
| Defects           | Severity, reproduction, owner, disposition and regression evidence                              |
| Approval          | Maintainer decision that every required gate is satisfied                                       |

No required gate may be “assumed green,” replaced by package existence or waived
in a release comment. Changing requirements needs a reviewed contract amendment.
Skipped/failed/unavailable evidence blocks the gate until supplied. Evidence from
an older commit requires a documented impact assessment and artifact identity;
rebuilds that change artifacts invalidate the relevant consumer evidence.

## Before rc.1: mandatory entry checklist

All boxes must be satisfied on the candidate and its release artifacts.

### Scope and contract closure

- [ ] M1–M4 and S are complete with linked exit evidence; no unresolved v1 syntax,
      API, AOT representation/versioning, lifecycle or support-floor questions.
- [ ] Spec, public exports, CLI, package entry points and documentation agree.
      `pnpm run test:spec` reports 100% of the current requirements, not merely
      the baseline 99; mapped tests also execute successfully.
- [ ] Final public-contract inventory and post-1.0 SemVer policy are recorded;
      diagnostics/codes, generated-module/runtime pairing, DOM replacement and
      AOT regeneration rules are explicit. No required surface is experimental.
- [ ] Security/escaping review covers trusted source, contextual escaping limits,
      raw strings, event arguments, references/properties and AOT artifact trust.
- [ ] No open P0/P1 against the frozen contract; every P2/P3 has a disposition.

### Compiler, native and JavaScript quality

- [ ] Repository gate passes: Rust fmt, locked strict workspace Clippy and tests,
      compiler docs; frozen pnpm install, format, typecheck, test, build and lint.
      Use the commands in `AGENTS.md`; Rust docs also run with warnings denied.
- [ ] `CI / Spec conformance`, `rust`, `Rust MSRV`, `rust (macos-latest)` and
      `rust (windows-latest)` pass. Exact compiler MSRV is tested by
      `.github/workflows/rust-msrv.yml` (baseline 1.91.0). Runtime-only MSRV gets
      its own job if M4 declares a different floor.
- [ ] Source-map tests exercise standalone expressions, nested control flow,
      bindings, native/WASM parity, and embedded Astro offsets, including Unicode.
      Runtime failures resolve to original templates. Static diagnostics retain
      original source attribution; static output does not promise JS source maps.
- [ ] Every package suite runs, including reactive, Events core, Astro Events,
      compiler wrapper and VS Code, even where the current PR workflow only runs
      a subset. `CI / typescript` and `astro-demo` are necessary, not a substitute
      for this inventory.

### Fuzz and adversarial health

- [ ] Replay the checked-in corpus and every known retained crash/minimized
      reproduction against the candidate; each fixed crash has a deterministic
      regression test. Missing historical artifacts are addressed by retained
      regression fixtures, not silently ignored.
- [ ] `Fuzz / Compiler (smoke)` passes a fresh bounded run (current workflow:
      75 seconds, `max_len=8192`, timeout 10 seconds, RSS limit 4096 MB).
- [ ] Review the latest scheduled 600-second result and every failure since the
      previous candidate/baseline. No unexplained crash, timeout or OOM remains.
      If the schedule has not exercised current compiler changes, run an equivalent
      600-second candidate run and record it. Infrastructure failure is not a pass.

### Distribution and compatibility

- [ ] `Release readiness` (`.github/workflows/release-readiness.yml`) passes:
      build/pack once, release artifact inspection, npm publish dry-runs, package
      content reproducibility, isolated Vite and Astro packed consumers on
      Linux/macOS/Windows, Vite/Astro/Prettier matrices and Node minimum.
- [ ] `pnpm run check:compatibility` passes. Baseline support is Node 22.12,
      Vite 6/7/8, Astro 5/6/7 and Prettier 3.0.0/latest 3.x; S records the final
      supported matrix and tests every declared range. No silent floor increase.
- [ ] Audit npm `exports`/types/main/files, WASM payload, internal version ranges,
      package names, no workspace protocols or checkout paths, and clean install
      without Rust. Audit the independently packaged VSIX and its compiler payload.
- [ ] Rust release dry-run quality/package/archive inspection passes through
      `.github/workflows/rust-release.yml` / `scripts/publish-rust.sh --dry-run`.
      Compiler/CLI and any AOT runtime ship required metadata, license and source;
      version ordering and MSRV are correct. CLI registry-resolution skips are
      recorded as pending publication checks, never represented as a successful
      registry install.
- [ ] Native static consumer acceptance covers compile once/render many,
      `render_serializable`, escaping/raw failures, Unicode, concurrency and
      Linux/macOS/Windows without Node. Before rc.1, use exact packaged candidate
      crates in isolated consumers; existing registry smoke is supporting evidence,
      not evidence that an unpublished candidate is on crates.io.
- [ ] AOT consumers pass the same static output/error fixtures, determinism,
      stale/version mismatch and malformed-artifact checks appropriate to the format.
      Final application excludes compiler/Oxc. Record binary/dependency/MSRV/build
      and render cost measurements, artifact sizes and source diagnostic results.

### Product acceptance and documentation

- [ ] Astro development E2E (`pnpm run test:e2e:demo`) and built production-preview
      acceptance (`pnpm run build:demo` then `pnpm run test:e2e:acceptance`) pass.
      Hono/Vite browser suite (`pnpm run test:e2e:hono-demo`) passes separately.
- [ ] Browser evidence includes scoped multi-instance references, conditional/loop
      replacement, bridge cleanup and no updates after disposal; text/checkbox/select/
      details forms, reset, submit, keyboard, focus/blur and composition boundaries;
      Events arguments and delegation after replacement. Existing capabilities tests
      alone do not establish these future contracts.
- [ ] No unexpected `pageerror` or `console.error`; expected errors are specifically
      allow-listed in tests. Browser/platform coverage is stated accurately.
- [ ] Installed editor acceptance proves `.flow` and inline Astro diagnostics,
      Unicode ranges, corrected/stale errors, highlighting, snippets and documented
      installation without requiring Rust. No full LSP claim.
- [ ] External browser/Astro/Vite and native Rust/AOT use is reviewed with exact
      revisions and results. Entwine is useful evidence, not an architectural owner
      or the only eligible consumer. Record unsupported use cases and workarounds.
- [ ] Website, capability labels, README, package/crate/editor instructions and
      examples describe final implemented behavior. Changelogs, compatibility and
      migration notes cover pre-1.0 API changes; no future proposal looks shipped.

## Changes after rc.1

Allowed: bug/security fixes, diagnostic correctness, documentation corrections,
test hardening, package/release repairs, performance improvements that preserve
contracts. Every fix carries reproduction and relevant regression/acceptance
results. Do not hide a behavioral change under “polish.”

Forbidden in ordinary RC work: new syntax, public API, package, binding/reactivity
semantics, static-template model, editor feature surface or framework integration.
Unfinished roadmap ideas wait beyond v1. An additional RC number does not by itself
authorize new features.

If a release blocker cannot be fixed without changing a public contract:

1. Record the blocker, why a compatible fix fails, the minimal contract change,
   migration impact and maintainer approval in a reviewed PR.
2. Amend the spec/conformance and RC inventory explicitly; do not silently mutate
   the frozen contract. If the change is a new product outcome, return to roadmap
   scope review and stabilization first.
3. Ship a new candidate (`rc.2`, then increment for later candidates); never replace
   an existing version's artifacts. Re-run affected acceptance, compatibility and
   downstream dogfood, then all release gates on the final candidate.

## Defect severity

| Level | Definition                                                                              | Release disposition                            |
| ----- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| P0    | Security boundary failure, corruption, crash on supported input, or release impossible  | Blocks immediately                             |
| P1    | Documented v1 contract materially broken, including supported install/portability paths | Blocks even if one consumer has a workaround   |
| P2    | Important issue outside material contract failure with a viable documented workaround   | Owner and explicit accepted risk required      |
| P3    | Polish or future capability                                                             | Track separately; no scope expansion during RC |

Severity follows user impact and contract, not implementation effort. A known
parser crash cannot be reclassified as polish to meet a date.

## RC to 1.0 graduation

Graduation is evidence-based, not “wait two weeks.” All entry gates remain green;
all candidate changes are resolved and retested; no P0/P1 remains. P2 risks and
workarounds are reviewed. Dogfood duration supports this evidence but cannot
replace a missing platform, fresh install or lifecycle test.

Before approving final publication, require:

- Fresh external npm consumers installing the published RC (or exact candidate
  artifacts where registry staging is unavailable), with real Vite/Astro dev/build
  and browser behavior; no workspace resolution.
- Fresh crates.io RC consumer and registry CLI installation when RC crates are
  published, plus the runtime-only AOT path and supported MSRVs. If staging uses
  packaged crates instead, record that distinction and keep the final registry
  check outstanding until publication; never claim a registry test of unpublished
  versions.
- Installed editor use, real native rendering, and browser acceptance against the
  latest candidate, with reviewed external consumer evidence and exact revisions.
- Final docs matching shipped behavior, migration guidance, manifest/export audit,
  security review and release dry-runs on the final release commit/artifacts.

Promoting versions can change metadata/artifacts. Repack and compare, and re-run
consumer checks where contents or dependency resolution change. Follow `RELEASE.md`
for npm and Rust publication; do not bypass the existing verified-artifact gates.
After publication, verify fresh installs of exact `1.0.0` npm/crate artifacts and
CLI, including AOT runtime pairing, before declaring the release complete. A
registry-only failure blocks completion and triggers the normal release repair
process; publication cannot honestly be pre-verified from a registry.

The release owner records the final decision and evidence links. This document
neither publishes a version nor authorizes merging any individual PR.
