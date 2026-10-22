use flowview_compiler::{compile_static_artifact, render_static, StaticRenderOptions};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    name: String,
    template: String,
    context: Value,
    expected: String,
}

#[test]
// @spec SPEC-HTML-127
fn aot_artifacts_match_runtime_static_and_shared_parity_fixtures() {
    for source in [
        include_str!("fixtures/layout-parity.json"),
        include_str!("fixtures/raw-interpolation-parity.json"),
    ] {
        let fixture: Fixture = serde_json::from_str(source).unwrap();
        for case in fixture.cases {
            let options = StaticRenderOptions::default().with_filename("fixtures/parity.flow");
            let static_html = render_static(&case.template, &case.context, options.clone())
                .unwrap()
                .html;
            let artifact = compile_static_artifact(&case.template, options).unwrap();
            let aot = flowview_static_runtime::Template::from_bytes(&artifact.bytes)
                .unwrap()
                .render(&case.context)
                .unwrap();
            assert_eq!(aot, static_html, "AOT/static mismatch in {}", case.name);
            assert_eq!(aot, case.expected, "fixture mismatch in {}", case.name);
        }
    }
}

#[test]
// @spec SPEC-HTML-127
fn unsupported_expressions_do_not_produce_an_artifact() {
    let result =
        compile_static_artifact("{{ context.title?.name }}", StaticRenderOptions::default());
    assert!(result.is_err());
}

#[test]
// @spec SPEC-HTML-128
fn artifact_bytes_are_deterministic_and_path_independent() {
    let source = "<p>{{ context.title }}</p>";
    let first = compile_static_artifact(source, StaticRenderOptions::default()).unwrap();
    let second = compile_static_artifact(source, StaticRenderOptions::default()).unwrap();
    assert_eq!(first.bytes, second.bytes);
    assert!(!String::from_utf8_lossy(&first.bytes).contains(env!("CARGO_MANIFEST_DIR")));
}

#[test]
// @spec SPEC-HTML-128
fn artifact_rejects_absolute_and_parent_relative_display_names() {
    for filename in [
        "/checkout/page.flow",
        "C:\\checkout\\page.flow",
        "../page.flow",
    ] {
        let result = compile_static_artifact(
            "<p>page</p>",
            StaticRenderOptions::default().with_filename(filename),
        );
        assert!(result.is_err(), "accepted nonlogical filename {filename}");
    }
}
