use assert_cmd::Command;
use std::{fs, str};

#[test]
fn cli_compiles_valid_template() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--runtime")
        .arg("@flowview/runtime")
        .write_stdin("<h1>{{ context.title }}</h1>");
    let output = cmd.output().unwrap();
    let stdout = str::from_utf8(&output.stdout).unwrap();
    assert!(stdout.contains("renderValue(context.title)"));
}

#[test]
fn cli_reports_human_errors_by_default() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile").arg("-").write_stdin("{{ context. }}");
    let output = cmd.output().unwrap();
    assert!(!output.status.success());
    let stderr = str::from_utf8(&output.stderr).unwrap();
    assert!(stderr.contains("error"));
    assert!(stderr.contains("FV0011"));
}

#[test]
fn cli_reports_json_errors_when_asked() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--diagnostic-format")
        .arg("json")
        .write_stdin("{{ context. }}");
    let output = cmd.output().unwrap();
    assert!(!output.status.success());
    let stderr = str::from_utf8(&output.stderr).unwrap();
    assert!(stderr.contains("\"diagnostics\""));
    assert!(stderr.contains("FV0011"));
}

#[test]
fn cli_writes_output_to_file() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("template.flow");
    let output = temp.path().join("template.js");
    fs::write(&input, "<h1>{{ context.title }}</h1>").unwrap();

    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg(&input)
        .arg("--out")
        .arg(&output)
        .arg("--runtime")
        .arg("@flowview/runtime");
    let result = cmd.output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        str::from_utf8(&result.stderr).unwrap()
    );

    let written = fs::read_to_string(&output).unwrap();
    assert!(written.contains("renderValue(context.title)"));
}

#[test]
fn cli_applies_line_offset_to_diagnostics() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--line-offset")
        .arg("10")
        .arg("--display-name")
        .arg("embedded.astro")
        .write_stdin("{{ context. }}");
    let output = cmd.output().unwrap();
    assert!(!output.status.success());
    let stderr = str::from_utf8(&output.stderr).unwrap();
    assert!(stderr.contains("embedded.astro:11:"));
}

#[test]
fn cli_respects_version_flag() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("--version");
    let output = cmd.output().unwrap();
    let stdout = str::from_utf8(&output.stdout).unwrap();
    assert!(stdout.contains("flowview"));
}

fn static_cmd(template: &str) -> Command {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--target")
        .arg("static-html")
        .write_stdin(template.to_string());
    cmd
}

#[test]
fn cli_explicit_js_target_matches_default() {
    let run = |explicit: bool| {
        let mut cmd = Command::cargo_bin("flowview").unwrap();
        cmd.arg("compile").arg("-");
        if explicit {
            cmd.arg("--target").arg("js");
        }
        cmd.write_stdin("<h1>{{ context.title }}</h1>");
        cmd.output().unwrap().stdout
    };
    assert_eq!(run(true), run(false));
}

#[test]
fn cli_static_html_without_data() {
    let output = static_cmd("<h1>Hello</h1>").output().unwrap();
    assert!(output.status.success());
    assert_eq!(str::from_utf8(&output.stdout).unwrap(), "<h1>Hello</h1>");
}

#[test]
fn cli_static_html_with_data_and_out() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("context.json");
    let out = temp.path().join("page.html");
    fs::write(&data, r#"{"title": "A & B"}"#).unwrap();

    let output = static_cmd("<h1>{{ context.title }}</h1>")
        .arg("--data")
        .arg(&data)
        .arg("--out")
        .arg(&out)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(fs::read_to_string(out).unwrap(), "<h1>A &amp; B</h1>");
}

#[test]
fn cli_static_html_invalid_json() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("context.json");
    fs::write(&data, "{ nope").unwrap();

    let output = static_cmd("x").arg("--data").arg(&data).output().unwrap();
    assert!(!output.status.success());
    assert!(str::from_utf8(&output.stderr)
        .unwrap()
        .contains("Invalid JSON"));
}

#[test]
fn cli_data_requires_static_target() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--data")
        .arg("x.json")
        .write_stdin("x");
    let output = cmd.output().unwrap();
    assert!(!output.status.success());
    assert!(str::from_utf8(&output.stderr)
        .unwrap()
        .contains("only valid with --target static-html"));
}

#[test]
fn cli_static_unsupported_expression_human_and_json() {
    let human = static_cmd("{{ context.f() }}").output().unwrap();
    assert!(!human.status.success());
    let stderr = str::from_utf8(&human.stderr).unwrap();
    assert!(stderr.contains("FV0016"));

    let json = static_cmd("{{ context.f() }}")
        .arg("--diagnostic-format")
        .arg("json")
        .output()
        .unwrap();
    let stderr = str::from_utf8(&json.stderr).unwrap();
    assert!(stderr.contains("\"diagnostics\""));
    assert!(stderr.contains("\"code\":\"FV0016\""));
    assert!(stderr.contains("\"line\":1"));
}

#[test]
fn cli_static_raw_interpolation_renders_trusted_html() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("context.json");
    fs::write(
        &data,
        r#"{"title": "<T>", "bodyHtml": "<h2>Boundaries</h2>"}"#,
    )
    .unwrap();

    let output = static_cmd("<h1>{{ context.title }}</h1>{{{ context.bodyHtml }}}")
        .arg("--data")
        .arg(&data)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        str::from_utf8(&output.stdout).unwrap(),
        "<h1>&lt;T&gt;</h1><h2>Boundaries</h2>"
    );
}

#[test]
fn cli_static_raw_value_type_error_is_a_json_diagnostic() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("context.json");
    fs::write(&data, r#"{"n": 1}"#).unwrap();

    let output = static_cmd("<p>\n{{{ context.n }}}</p>")
        .arg("--data")
        .arg(&data)
        .arg("--diagnostic-format")
        .arg("json")
        .arg("--display-name")
        .arg("page.flow")
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = str::from_utf8(&output.stderr).unwrap();
    assert!(stderr.contains("\"code\":\"FV0025\""), "{stderr}");
    assert!(stderr.contains("\"filename\":\"page.flow\""), "{stderr}");
    assert!(stderr.contains("\"line\":2"), "{stderr}");
    assert!(stderr.contains("\"severity\":\"error\""), "{stderr}");
}

#[test]
fn cli_js_target_rejects_raw_interpolation_in_attributes_with_json_diagnostic() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--diagnostic-format")
        .arg("json")
        .arg("--display-name")
        .arg("page.flow")
        .write_stdin("<div title=\"{{{ context.html }}}\"></div>");
    let output = cmd.output().unwrap();
    assert!(!output.status.success());
    let stderr = str::from_utf8(&output.stderr).unwrap();
    assert!(stderr.contains("\"code\":\"FV0022\""), "{stderr}");
    assert!(stderr.contains("\"filename\":\"page.flow\""), "{stderr}");
    assert!(stderr.contains("\"line\":1"), "{stderr}");
    assert!(stderr.contains("\"column\":"), "{stderr}");
}

#[test]
fn cli_js_target_emits_raw_helper() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg("-")
        .write_stdin("<article>{{{ context.body }}}</article>");
    let output = cmd.output().unwrap();
    assert!(output.status.success());
    let stdout = str::from_utf8(&output.stdout).unwrap();
    assert!(stdout.contains("renderRawValue(context.body)"));
}
