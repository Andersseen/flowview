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
fn cli_transports_javascript_and_source_map_as_json() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--source-map")
        .arg("--source-map-name")
        .arg("src/page.flow")
        .write_stdin("<p>{{ context.name }}</p>");
    let output = cmd.output().unwrap();
    assert!(output.status.success());
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(result["code"].as_str().unwrap().contains("context.name"));
    let map = &result["sourceMap"];
    assert_eq!(map["version"], 3);
    assert_eq!(map["sources"][0], "src/page.flow");
    assert!(!map["mappings"].as_str().unwrap().is_empty());
}

#[test]
fn cli_accepts_embedded_host_source_through_stdin_without_extra_arguments() {
    let mut cmd = Command::cargo_bin("flowview").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--source-map")
        .arg("--source-map-input-json")
        .arg("--source-map-name")
        .arg("src/component.astro")
        .write_stdin(
            serde_json::json!({
                "source": "{{ context.name }}",
                "sourceMapSourceContent": "<template>{{ context.name }}</template>"
            })
            .to_string(),
        );
    let output = cmd.output().unwrap();
    assert!(output.status.success());
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        result["sourceMap"]["sourcesContent"][0],
        "<template>{{ context.name }}</template>"
    );
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

#[test]
fn cli_static_html_reads_template_file_and_prints_to_stdout() {
    let temp = tempfile::tempdir().unwrap();
    let template = temp.path().join("page.flow");
    let data = temp.path().join("context.json");
    fs::write(&template, "<h1>{{ context.title }}</h1>").unwrap();
    fs::write(&data, r#"{"title": "<Hi>"}"#).unwrap();

    let mut cmd = Command::cargo_bin("flowview").unwrap();
    let output = cmd
        .arg("compile")
        .arg(&template)
        .args(["--target", "static-html", "--data"])
        .arg(&data)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        str::from_utf8(&output.stdout).unwrap(),
        "<h1>&lt;Hi&gt;</h1>"
    );
}

#[test]
fn cli_static_html_rejects_non_object_json() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("context.json");
    fs::write(&data, "[1, 2]").unwrap();

    let output = static_cmd("x")
        .arg("--data")
        .arg(&data)
        .args(["--diagnostic-format", "json"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(str::from_utf8(&output.stderr).unwrap().contains("FV0021"));
}

#[test]
fn cli_static_html_missing_data_file() {
    let output = static_cmd("x")
        .arg("--data")
        .arg("definitely-missing-context.json")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(str::from_utf8(&output.stderr)
        .unwrap()
        .contains("Failed to read definitely-missing-context.json"));
}

#[test]
fn cli_static_html_data_cannot_come_from_stdin() {
    let output = static_cmd("x").args(["--data", "-"]).output().unwrap();
    assert!(!output.status.success());
    assert!(str::from_utf8(&output.stderr)
        .unwrap()
        .contains("stdin is reserved for the template"));
}

#[test]
fn cli_static_html_diagnostics_use_display_name() {
    let output = static_cmd("<p>{{ context.f(1) }}</p>")
        .args(["--display-name", "docs/page.flow"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(str::from_utf8(&output.stderr)
        .unwrap()
        .contains("docs/page.flow:1:"));
}
