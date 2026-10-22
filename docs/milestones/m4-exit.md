# M4 exit evidence: Precompiled Static Templates

**Status: ready for maintainer acceptance.** This file maps the M4 exit contract in
[`v1-roadmap.md`](../v1-roadmap.md#m4--precompiled-static-templates-aot) to
implementation and evidence. A local result or an open PR does not grant
maintainer acceptance. No crate or npm package was published for this work.

## Candidate and architecture

- Base commit: `0c45006b515a3393ef6f8ffdd72c64fdcfecfa8a` (PR #47 merge).
- Candidate implementation SHA: `2f7337bcefa39bfddae69f5a4b2f081df5a17c03`.
- CI-verified phase-transition candidate SHA:
  `c69fb8ec985227b19f29d707bdafbdd90baf27a4`.
  [CI run 116](https://github.com/Andersseen/flowview/actions/runs/39803656544)
  and [Fuzz run 53](https://github.com/Andersseen/flowview/actions/runs/39803656401)
  completed successfully on this SHA, including all three packaged-consumer OS
  jobs, Rust MSRVs, release readiness and browser acceptance.
- Versions: `flowview-static-runtime 0.1.0`; compiler, CLI and WASM `0.3.0`.
- Accepted design: the existing shared parser/AST and compiler static lowering
  emit deterministic, versioned JSON IR; `flowview-static-runtime` validates,
  prepares and renders it. No second parser, artifact format, runtime or syntax
  was added. See [`m4-aot.md`](../decisions/m4-aot.md).

## Acceptance matrix

| M4 requirement                                                                  | Implementation                                               | Evidence / current result                                                                                                                                                  | Disposition                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Trusted `.flow` can become a supported artifact and render without compiler/Oxc | CLI `precompile`; `flowview-static-runtime::Template`        | Existing AOT consumer, dependency graph and executable checks; packaged consumer passed locally and on Linux/macOS/Windows in CI run 115                                   | Satisfied                                                          |
| Same parser, static subset, escaping, whitespace and diagnostics                | `flowview-compiler` static lowering; shared parity fixtures  | `cargo test --workspace --locked`; AOT parity and diagnostics tests passed                                                                                                 | Satisfied by existing implementation/tests                         |
| Determinism and stale-output detection                                          | CLI artifact generation / `--check`                          | CLI tests cover byte determinism and missing/stale read-only checks; CI checks committed artifact                                                                          | Satisfied; candidate CI pending                                    |
| Versioned artifact validation and resource limits                               | Runtime decoder                                              | Runtime tests cover unsupported identity/version, truncation, size limit and arbitrary bytes                                                                               | Satisfied by existing implementation/tests                         |
| Packaged runtime is consumable outside the workspace                            | `scripts/verify-aot-packaged-consumer.sh`                    | Cargo archive extracted to a temp directory; typed/native consumer passed; archive, manifest, output and error checks passed in CI run 115 on Linux/macOS/Windows          | Satisfied                                                          |
| Final normal/build graph excludes compiler and Oxc                              | Runtime package dependency graph                             | Extracted-package `cargo tree -e normal,build` contains runtime, Serde and serde_json only; external executable ran on Linux/macOS/Windows                                 | Satisfied                                                          |
| Runtime and compiler toolchain floors remain distinct                           | Runtime manifest and Rust MSRV workflow                      | Runtime tests pass on Rust 1.85.0; compiler/CLI tests pass on Rust 1.91.0 locally and in CI run 115                                                                        | Satisfied                                                          |
| Linux, macOS and Windows consumer support                                       | CI Rust jobs                                                 | Packaged-consumer step passed in all three OS jobs in CI run 115                                                                                                           | Satisfied                                                          |
| Cargo release order and immutable-version safety                                | `scripts/publish-rust.sh`                                    | Runtime → compiler → CLI; matching public checksum skips, mismatch fails. Local dry-run could not reach crates.io in this environment                                      | Script reviewed; remote registry checks unavailable/unpublished    |
| Downstream dry-run skips are honest                                             | `scripts/publish-rust.sh --dry-run`                          | Controlled script-path check confirmed exact missing dependencies and `NOT EXECUTED` messages; cargo publish was stubbed. Actual crates.io dry-run remains network-blocked | Skip behavior verified; actual registry dry-run remains unexecuted |
| Tradeoffs measured and interpreted                                              | `scripts/measure-aot.py`, AOT decision                       | Existing matched macOS/Rust 1.91 measurements and one-machine limitations documented; no new performance claim                                                             | Accepted as bounded evidence; not a universal guarantee            |
| Documentation and release status accurate                                       | Embedding guide, compatibility docs, `RELEASE.md`, this file | Candidate-package and registry evidence are distinguished; CI run 115 and Fuzz 52 passed; no publication claimed                                                           | Satisfied                                                          |

## Commands and evidence levels

Local candidate-package verification passed:

```text
scripts/verify-aot-packaged-consumer.sh
```

The script uses Cargo to create the `.crate`, inspects and extracts it, and
builds the external consumer from the extracted package. It is not registry
verification. On this machine, `scripts/publish-rust.sh --dry-run` was attempted
but could not contact `https://index.crates.io/config.json` because network name
resolution is unavailable; no registry dry-run result is claimed.

The skip-reporting branches were also exercised with a temporary `curl` stub
reporting no published versions and a `cargo publish` stub intercepting the
runtime dry-run. This confirmed the compiler and CLI report their exact missing
registry dependency and required follow-up; it did not execute a real Cargo
publish dry-run.

The full local Rust gate passed through package creation:

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
RUSTDOCFLAGS='-D warnings' cargo doc --workspace --no-deps --locked
cargo package --workspace --exclude flowview-wasm --locked --no-verify --offline
```

The full local gates that passed include:

```text
CI=true pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm test:spec                         # 130/130
pnpm check:compatibility
pnpm build:demo
pnpm test:e2e:demo                     # 37 passed
pnpm test:e2e:hono-demo                # 4 passed
ASTRO_PREVIEW_BACKGROUND=0 pnpm test:e2e:acceptance # 18 passed
pnpm pack:release-artifacts <temp-dir>
pnpm verify:release-artifacts <temp-dir> # 10 tarballs passed
cargo +nightly fuzz run compiler <copied-temp-corpus> -- -runs=100 -max_len=8192 -timeout=10 -rss_limit_mb=4096
```

The packed Vite consumer then attempted to download Vite, TypeScript and
`@jridgewell/trace-mapping` from npm and could not resolve `registry.npmjs.org`.
Packed Astro/Prettier consumers were not run after that dependency failure.
`scripts/publish-rust.sh --dry-run` likewise could not reach crates.io. These
are unexecuted local distribution checks, not passes. CI run 115 subsequently
passed the packed Vite/Astro/Prettier consumer matrix, release artifact
validation, Node minimum, TypeScript and browser acceptance jobs. Package
archive validation and the AOT packaged consumer remain distinct from registry
installation.

## Registry and publication status

The existing release workflow remains authoritative for registry evidence:
runtime registry consumer after runtime publication, compiler registry consumer
after compiler publication, and exact CLI installation after CLI publication.
These steps were not run. The workflow is not a substitute for the local
packaged-candidate test, and the packaged-candidate test is not a substitute for
those registry checks. Nothing was published.

## Acceptance decision

M4's exit criteria are **satisfied on the CI-verified candidate SHA above**.
Registry-installed Rust consumers and exact CLI installation remain
post-publication checks because no crate was published here. The PR proposes M4
complete and S active; that phase transition takes effect only through normal
maintainer-reviewed merge. No S milestone work is included here.
