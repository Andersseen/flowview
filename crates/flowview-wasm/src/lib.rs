use flowview_compiler::{compile as compile_template, CompileOptions, Diagnostic};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WasmCompileOptions {
    filename: Option<String>,
    runtime_import: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum WasmCompileResult {
    Ok {
        code: String,
        warnings: Vec<WasmDiagnostic>,
    },
    Err {
        diagnostics: Vec<WasmDiagnostic>,
    },
}

#[derive(Debug, Serialize)]
struct WasmDiagnostic {
    message: String,
    severity: &'static str,
    code: Option<String>,
    filename: String,
    line: usize,
    column: usize,
    start: usize,
    end: usize,
}

#[wasm_bindgen(js_name = compile)]
pub fn compile(source: &str, options: JsValue) -> JsValue {
    let options = serde_wasm_bindgen::from_value::<WasmCompileOptions>(options).unwrap_or(
        WasmCompileOptions {
            filename: None,
            runtime_import: None,
        },
    );
    let filename = options.filename.unwrap_or_else(|| "<inline>".to_string());
    let runtime_import = options
        .runtime_import
        .unwrap_or_else(|| "@flowview/runtime".to_string());
    let compile_options = CompileOptions::new(runtime_import).with_filename(&filename);

    let result = match compile_template(source, compile_options) {
        Ok(output) => WasmCompileResult::Ok {
            code: output.code,
            warnings: diagnostics_to_wasm(output.warnings, &filename),
        },
        Err(diagnostics) => WasmCompileResult::Err {
            diagnostics: diagnostics_to_wasm(diagnostics, &filename),
        },
    };

    serde_wasm_bindgen::to_value(&result).expect("serialize flowview compile result")
}

fn diagnostics_to_wasm(diagnostics: Vec<Diagnostic>, filename: &str) -> Vec<WasmDiagnostic> {
    diagnostics
        .into_iter()
        .map(|diagnostic| WasmDiagnostic {
            message: diagnostic.message,
            severity: match diagnostic.severity {
                flowview_compiler::DiagnosticSeverity::Error => "error",
                flowview_compiler::DiagnosticSeverity::Warning => "warning",
            },
            code: diagnostic.code,
            filename: filename.to_string(),
            line: diagnostic.line,
            column: diagnostic.column,
            start: diagnostic.start,
            end: diagnostic.end,
        })
        .collect()
}
