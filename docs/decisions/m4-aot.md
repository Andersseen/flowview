# M4 decision: precompiled static templates

**Status:** selected for review with M4, 2026-10-22. The milestone remains
active until the PR's cross-platform and CI evidence has settled.

## Problem

`compile_static` is useful for runtime-selected templates, but its final binary
links `flowview-compiler`, Oxc, validation and lowering even when the template
is known at build time. M4 needs a reproducible compiler step and a final
consumer that can render without that stack, while preserving the shared parser,
AST, static subset and existing runtime-compilation API.

## Prototypes and measurements

The serialized-IR prototype is the production architecture: the CLI serializes
the compiler's lowered static representation into a versioned JSON artifact,
and a separate runtime validates and prepares it. The generated-Rust prototype
emits a Rust module containing the same artifact as a raw byte string and a
loader that calls the runtime. This is an actual buildable `include!`-style
candidate, not a hypothetical comparison. It measures generated-source
overhead and consumer scaling without making the compiler's IR public.

Both candidates use the same runtime decoder and renderer, same page template,
Rust 1.91 toolchain, macOS target, release profile (opt-level 3, LTO, one
codegen unit, stripped, panic abort), dependency versions and application
context. `scripts/measure-aot.py` generates 1, 10 and 50 distinct artifacts,
builds both candidate consumers and reports artifact/source/binary bytes and
clean/incremental build times. The paired runtime loops in the consumer
examples compare 500 compile/prepares and 10,000 renders. Timings are one-run
observations, not guarantees.

| Candidate              | Artifact bytes, 1 / 10 / 50 | Generated Rust, 1 / 10 / 50 | Binary bytes, 1 / 10 / 50   |
| ---------------------- | --------------------------- | --------------------------- | --------------------------- |
| Serialized JSON IR     | 4,455 / 44,550 / 222,830    | —                           | 517,776 / 567,312 / 748,944 |
| Generated Rust wrapper | 4,455 / 44,550 / 222,830    | 4,722 / 47,220 / 236,180    | 517,776 / 567,312 / 748,944 |

The single-template clean build took 12.213 s for serialized IR and 10.738 s
for generated Rust in this run. The 10- and 50-template builds were
incremental in the same project: 2.818 / 3.297 s for serialized IR and 2.891 /
3.146 s for generated Rust. Clean timings are sensitive to machine/compiler
caches and are reported as observations. The generated wrapper adds about 6%
source bytes without reducing binary size, changing runtime preparation or
rendering, or improving multi-template scaling. A direct generated renderer or
static structure would need a second emitted evaluator/API surface and was not
implemented as a production alternative; see limitations below.

For the same representative page model, 500 `compile_static` calls took
299.883 ms total (599.8 µs/template); 500 artifact loads took 9.455 ms total
(18.9 µs/template). Ten thousand renders took 61.390 ms (6.14 µs/render) via
the compiler consumer and 16.706 ms (1.67 µs/render) via the artifact runtime.
`render_serializable` measured 5.65 µs and 1.81 µs per render respectively.
The matched stripped binaries were 1,163,504 B for runtime compilation and
517,824 B for AOT, a difference of 645,680 B (55.5%). This delta is the
combined dependency and link result; it is not attributed to Oxc alone.

## Decision

Ship one production path: deterministic versioned serialized IR consumed by
`flowview-static-runtime`. Keep compiler IR types private. This gives consumers
a small stable API, clear format rejection, canonical regeneration and a
runtime-only Cargo graph. The generated-Rust wrapper is rejected as the primary
path because it has the same binary, decoder, preparation and render costs,
while adding source expansion and another generated file form. No prototype
module or builder API is shipped in the runtime crate.

The separate runtime crate is necessary: it is the narrow dependency boundary
that removes the compiler/Oxc from the final normal/build graph. Its direction
is `flowview-static-runtime` ← `flowview-compiler` ← `flowview-cli`.

## Artifact and compatibility contract

- Artifacts are compact JSON with magic `FLOWVIEW-STATIC` and format version
  `1`. The compiler version is recorded for diagnosis; the runtime does not use
  it as a compatibility gate. Unknown magic/version, unknown schema fields,
  invalid nodes/expressions, truncation and inputs larger than 16 MiB return
  errors.
- The format version is independent of crate/compiler versions. A runtime
  accepts only format versions it implements. A format change that cannot be
  read by the old runtime requires a format-version increment and fails clearly
  until the consumer updates/regenerates. Compatible compiler patch changes do
  not force the runtime to reject an artifact.
- Complete template source and a caller-provided logical filename are included
  to preserve source locations in runtime diagnostics. This has a size and
  privacy cost: templates must not contain secrets. Absolute and parent-relative
  display names are rejected, and source filesystem paths are never serialized.
- Serialization order is deterministic. Identical source, compiler version,
  logical filename and options produce byte-identical bytes. CLI `--check`
  recompiles and byte-compares the expected canonical artifact; it does not
  rewrite. Since compiler version is metadata, regenerating with a new compiler
  release can make `--check` stale even when format compatibility is unchanged.
- Normal output is compiled and serialized before a same-directory temporary
  file is synced and renamed into place. A compile failure leaves an existing
  artifact untouched.

## Runtime boundary and toolchains

The runtime contains only artifact decoding/validation, preparation, rendering
and static diagnostics. It has no parser, Oxc, CLI, filesystem codegen or
compiler dependency. `cargo tree -e normal,build` for the committed consumer
contains `flowview-static-runtime`, Serde and serde_json, with no
`flowview-compiler` or Oxc crates. The AOT binary likewise contains no compiler
link path.

The compiler remains Rust 1.91 and continues to own parsing, validation and
expression lowering. The runtime declares Rust 1.85 and is tested on exactly
1.85.0. Regeneration requires Rust 1.91; a runtime-only final application can
use Rust 1.85 subject to its other dependencies. No compiler MSRV increase or
dependency downgrade is part of M4.

## Diagnostics, semantics and trust

The compiler calls the same parser, validation and Oxc-backed static lowerer as
`compile_static`; unsupported expressions fail before an artifact is produced.
The runtime maps failures back to FlowView diagnostic codes, source locations
and logical filenames. Shared fixtures compare AOT, `compile_static` and
expected HTML. Preparation happens once at `Template::from_bytes`; templates
are immutable and concurrent render tests pass. `render_serializable` still
serializes through `serde_json::Value`.

Escaped text/attributes, explicit trusted raw strings, whitespace, control flow,
bindings, truthiness, `.length` and `track` warning behavior are unchanged. A
context is data and escaped by existing rules. Template source and generated
artifacts are trusted build inputs; the runtime is not an untrusted-template
sandbox. Raw interpolation remains verbatim and is the caller's trust boundary.
Malformed artifacts are treated as input: a 16 MiB cap, serde's bounded
recursion handling and adversarial arbitrary-byte tests ensure errors rather
than panics or unbounded declared-length allocations.

## Release and validation

Rust versions move coherently to compiler/CLI/WASM 0.3.0; runtime begins at
0.1.0. Publish order is runtime → compiler → CLI, with a runtime-only registry
consumer check before compiler publication. Dry-run skips unpublished
dependencies and states why. No crate is published in this implementation
task, and no npm Changeset is needed because npm behavior did not change.

The runtime package archive was inspected and excludes tests. The standalone
committed-artifact consumer builds and renders, and the compiler/Oxc absence is
verified from its Cargo graph. Linux/macOS/Windows CI jobs exercise that
consumer and artifact check; those remote results are required before M4 exit.
Local Rust workspace tests, clippy, formatting, docs, exact runtime MSRV,
package creation, spec coverage and the complete local pnpm typecheck/test/build/
lint chain were run. The frozen pnpm install could not access npm due the
environment's network restriction; existing dependencies were used. Browser
E2E, packed npm artifacts, scheduled fuzz health and release dry-run remain
separate remote/release evidence, not claimed as passed here.

## Limitations and deferrals

The JSON artifact embeds full source and a compact private lowered tree; it is
limited to 16 MiB and the implemented static subset. The generated-Rust
prototype only embeds canonical bytes; it does not benchmark a second
handwritten specialized evaluator. That option was not selected because it
would duplicate rendering logic and require decisions about a larger generated
API before measurements show a material advantage. Fragments, partials,
recursion, optional chaining, new syntax, zero-copy typed rendering, compression
modes, remote caches, build.rs frameworks, proc macros, and stabilization are
outside M4.
