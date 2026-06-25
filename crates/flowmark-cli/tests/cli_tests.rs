use assert_cmd::Command;
use std::{fs, str};

#[test]
fn cli_compiles_valid_template() {
    let mut cmd = Command::cargo_bin("flowmark").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--runtime")
        .arg("@flowmark/runtime")
        .write_stdin("<h1>{{ context.title }}</h1>");
    let output = cmd.output().unwrap();
    let stdout = str::from_utf8(&output.stdout).unwrap();
    assert!(stdout.contains("renderValue(context.title)"));
}

#[test]
fn cli_reports_human_errors_by_default() {
    let mut cmd = Command::cargo_bin("flowmark").unwrap();
    cmd.arg("compile").arg("-").write_stdin("{{ context. }}");
    let output = cmd.output().unwrap();
    assert!(!output.status.success());
    let stderr = str::from_utf8(&output.stderr).unwrap();
    assert!(stderr.contains("error"));
    assert!(stderr.contains("FM0011"));
}

#[test]
fn cli_reports_json_errors_when_asked() {
    let mut cmd = Command::cargo_bin("flowmark").unwrap();
    cmd.arg("compile")
        .arg("-")
        .arg("--diagnostic-format")
        .arg("json")
        .write_stdin("{{ context. }}");
    let output = cmd.output().unwrap();
    assert!(!output.status.success());
    let stderr = str::from_utf8(&output.stderr).unwrap();
    assert!(stderr.contains("\"diagnostics\""));
    assert!(stderr.contains("FM0011"));
}

#[test]
fn cli_writes_output_to_file() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("template.flow");
    let output = temp.path().join("template.js");
    fs::write(&input, "<h1>{{ context.title }}</h1>").unwrap();

    let mut cmd = Command::cargo_bin("flowmark").unwrap();
    cmd.arg("compile")
        .arg(&input)
        .arg("--out")
        .arg(&output)
        .arg("--runtime")
        .arg("@flowmark/runtime");
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
    let mut cmd = Command::cargo_bin("flowmark").unwrap();
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
    let mut cmd = Command::cargo_bin("flowmark").unwrap();
    cmd.arg("--version");
    let output = cmd.output().unwrap();
    let stdout = str::from_utf8(&output.stdout).unwrap();
    assert!(stdout.contains("flowmark"));
}
