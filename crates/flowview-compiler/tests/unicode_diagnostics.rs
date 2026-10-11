//! Regression tests for UTF-8 safe diagnostic spans, found by cargo-fuzz:
//! a malformed expression containing U+FFFD made the Oxc label offsets land
//! inside a multibyte character and diagnostic construction panicked.

use flowview_compiler::{
    compile, compile_static, parse_ast, render_static, CompileOptions, Diagnostic,
    StaticRenderOptions,
};
use serde_json::json;

fn assert_spans(source: &str, diagnostics: &[Diagnostic]) {
    assert!(!diagnostics.is_empty());
    for d in diagnostics {
        assert!(
            d.start <= d.end && d.end <= source.len(),
            "{d:?} in {source:?}"
        );
        assert!(source.is_char_boundary(d.start), "{d:?} in {source:?}");
        assert!(source.is_char_boundary(d.end), "{d:?} in {source:?}");
        assert!(d.line >= 1 && d.column >= 1);
    }
}

fn all_paths(source: &str) {
    assert_spans(source, &parse_ast(source).unwrap_err());
    assert_spans(
        source,
        &compile(source, CompileOptions::new("@flowview/runtime")).unwrap_err(),
    );
    assert_spans(
        source,
        &compile_static(source, StaticRenderOptions::default())
            .err()
            .unwrap(),
    );
    assert_spans(
        source,
        &render_static(source, &json!({}), StaticRenderOptions::default()).unwrap_err(),
    );
}

/// Minimized from the fuzz crashes: `<p[]="\\\xa4\x00"` read through
/// `String::from_utf8_lossy`.
#[test]
fn minimized_fuzz_crash_reports_valid_spans() {
    let source = String::from_utf8_lossy(b"<p[]=\"\\\\\xa4\x00\"").into_owned();
    assert!(source.contains('\u{FFFD}'));
    all_paths(&source);
}

/// Quoted attribute values drop backslash escapes (`\\\\` becomes `\\`), so offsets
/// Oxc reports inside the unescaped expression do not map 1:1 onto source
/// bytes and can fall inside a following multibyte character.
#[test]
fn escaped_attribute_values_before_multibyte_text_report_valid_spans() {
    for tail in ["é", "€", "🙂", "\u{FFFD}"] {
        all_paths(&format!("<p [x]=\"\\\\\\\\{tail}{tail}\\\"\"></p>"));
    }
}

#[test]
fn invalid_expressions_with_multibyte_characters_report_valid_spans() {
    for ch in ["é", "€", "🙂", "\u{FFFD}", "\u{00A0}", "\u{3000}"] {
        all_paths(&format!("{{{{ \\{ch}\\ }}}}"));
        all_paths(&format!("<p [x]=\"\\\\{ch}\\0\"></p>"));
        all_paths(&format!("@if (\\{ch}) {{ x }}"));
    }
}

#[test]
fn ascii_diagnostic_columns_are_unchanged() {
    let errors = parse_ast("line\n{{ + }}").unwrap_err();
    assert_eq!((errors[0].line, errors[0].column), (2, 5));
}
