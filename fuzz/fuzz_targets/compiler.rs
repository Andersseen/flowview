#![no_main]

use flowview_compiler::{compile, compile_static, parse_ast, render_static, CompileOptions, StaticRenderOptions};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let source = String::from_utf8_lossy(data);
    let _ = parse_ast(&source);
    let _ = compile(&source, CompileOptions::new("@flowview/runtime"));
    let _ = compile_static(&source, StaticRenderOptions::default());
    let _ = render_static(&source, &serde_json::json!({}), StaticRenderOptions::default());
});
