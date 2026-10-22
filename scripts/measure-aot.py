#!/usr/bin/env python3
"""Reproduce the AOT IR/generated-Rust consumer scaling measurements."""

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "examples/aot-consumer/page.flow"
SMALL_SOURCE = ROOT / "examples/aot-consumer/small.flow"
RUST_GENERATOR = ROOT / "scripts/aot-rust-prototype.mjs"
COUNTS = (1, 10, 50)
PROFILE = {
    "CARGO_PROFILE_RELEASE_OPT_LEVEL": "3",
    "CARGO_PROFILE_RELEASE_LTO": "true",
    "CARGO_PROFILE_RELEASE_CODEGEN_UNITS": "1",
    "CARGO_PROFILE_RELEASE_STRIP": "true",
    "CARGO_PROFILE_RELEASE_PANIC": "abort",
}


def run(args, *, cwd=None, env=None, quiet=False):
    return subprocess.run(
        [str(arg) for arg in args],
        cwd=cwd,
        env=env,
        check=True,
        stdout=subprocess.DEVNULL if quiet else None,
        stderr=subprocess.DEVNULL if quiet else None,
    )


def timed(args, *, cwd=None, env=None):
    start = time.perf_counter()
    run(args, cwd=cwd, env=env, quiet=True)
    return time.perf_counter() - start


def main_source(count, generated):
    modules = "\n".join(f"mod template_{i:02};" for i in range(count)) if generated else ""
    loads = (
        ",".join(f"template_{i:02}::load_template().unwrap()" for i in range(count))
        if generated
        else ",".join(
            f"flowview_static_runtime::Template::from_bytes(include_bytes!(\"../artifacts/template-{i:02}.json\")).unwrap()"
            for i in range(count)
        )
    )
    return f'''{modules}
fn main() {{
    let templates = vec![{loads}];
    let context = serde_json::json!({{"title":"AOT scale","description":"","body_html":"<p>x</p>","navigation":[]}});
    for template in templates {{ std::hint::black_box(template.render(&context).unwrap()); }}
}}
'''


def create_consumer(path):
    path.mkdir(parents=True)
    (path / "src").mkdir()
    (path / "src/bin").mkdir()
    (path / "artifacts").mkdir()
    (path / "Cargo.toml").write_text(
        f'''[package]\nname = "flowview-aot-measure"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[dependencies]\nflowview-static-runtime = {{ path = "{ROOT / 'crates/flowview-static-runtime'}" }}\nserde_json = "1"\n\n[workspace]\n''',
        encoding="utf-8",
    )


def measure_candidate(root, generated, env, *, variant, source_path, counts):
    label = "generated-rust" if generated else "serialized-ir"
    package = root / f"{label}-{variant}"
    create_consumer(package)
    target = root / f"target-{label}-{variant}"
    results = []
    generation_seconds = 0.0
    rust_generation_seconds = 0.0

    source_text = source_path.read_text(encoding="utf-8")
    for count in counts:
        for i in range(count):
            source = package / f"template-{i:02}.flow"
            source.write_text(source_text + f"\n<!-- measured template {i} -->\n", encoding="utf-8")
            artifact = package / f"artifacts/template-{i:02}.json"
            start = time.perf_counter()
            run([
                ROOT / "target/debug/flowview", "precompile", source,
                "--out", artifact, "--display-name", f"templates/template-{i:02}.flow",
            ], quiet=True)
            generation_seconds += time.perf_counter() - start
            if generated:
                module = package / f"src/template_{i:02}.rs"
                start = time.perf_counter()
                run(["node", RUST_GENERATOR, artifact, module], quiet=True)
                rust_generation_seconds += time.perf_counter() - start

        main = package / "src/main.rs"
        main.write_text(main_source(count, generated), encoding="utf-8")
        seconds = timed([
            "cargo", "build", "--manifest-path", package / "Cargo.toml",
            "--release", "--target-dir", target,
        ], env=env)
        binary = target / "release/flowview-aot-measure"
        artifact_bytes = sum((package / f"artifacts/template-{i:02}.json").stat().st_size for i in range(count))
        source_bytes = sum((package / f"src/template_{i:02}.rs").stat().st_size for i in range(count)) if generated else 0
        results.append((count, artifact_bytes, source_bytes, binary.stat().st_size, seconds))

    print(
        f"\n{label} ({variant}): artifact generation {generation_seconds:.3f}s, "
        f"Rust wrapper generation {rust_generation_seconds:.3f}s for {sum(counts)} templates"
    )
    print("templates | artifact bytes | generated Rust bytes | binary bytes | build seconds")
    for row in results:
        count, artifact_bytes, source_bytes, binary_bytes, seconds = row
        print(f"{count:9} | {artifact_bytes:14} | {source_bytes:20} | {binary_bytes:12} | {seconds:.3f}")


def main():
    cargo = shutil.which("cargo")
    node = shutil.which("node")
    if not cargo or not node:
        raise SystemExit("cargo and node are required")
    run([cargo, "build", "-p", "flowview-cli", "--locked"], cwd=ROOT, quiet=True)
    env = os.environ.copy()
    env.update(PROFILE)
    with tempfile.TemporaryDirectory(prefix="flowview-aot-measure-") as temporary:
        root = Path(temporary)
        measure_candidate(root, False, env, variant="small", source_path=SMALL_SOURCE, counts=(1,))
        measure_candidate(root, True, env, variant="small", source_path=SMALL_SOURCE, counts=(1,))
        measure_candidate(root, False, env, variant="report", source_path=SOURCE, counts=COUNTS)
        measure_candidate(root, True, env, variant="report", source_path=SOURCE, counts=COUNTS)


if __name__ == "__main__":
    main()
