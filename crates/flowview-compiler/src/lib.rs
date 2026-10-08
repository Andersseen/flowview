//! Flowview template compiler.
//!
//! One parser and one AST feed two backends:
//!
//! - [`compile`] emits a JavaScript render function (used by the npm packages).
//! - [`compile_static`] / [`render_static`] render `template + JSON → HTML`
//!   natively, with no JavaScript runtime. The output is final HTML and needs
//!   no Flowview client code.
//!
//! # Embedding in a Rust tool
//!
//! Compile a template once, then render it for as many page models as you
//! like. A [`CompiledStaticTemplate`] is immutable and `Send + Sync`, so it
//! can be shared across threads.
//!
//! ```
//! use flowview_compiler::{compile_static, StaticCompileOptions};
//! use serde::Serialize;
//!
//! const TEMPLATE: &str = r#"<h1>{{ context.title }}</h1>{{{ context.body_html }}}"#;
//!
//! #[derive(Serialize)]
//! struct PageModel {
//!     title: String,
//!     body_html: String, // trusted, rendered by the caller
//! }
//!
//! let template = compile_static(
//!     TEMPLATE,
//!     StaticCompileOptions::default().with_filename("page.flow"),
//! )
//! .expect("template compiles");
//!
//! let model = PageModel {
//!     title: "A & B".into(),
//!     body_html: "<p>Rendered elsewhere.</p>".into(),
//! };
//! let value = serde_json::to_value(model).unwrap();
//! let html = template.render(&value).expect("context renders");
//!
//! assert_eq!(html, "<h1>A &amp; B</h1><p>Rendered elsewhere.</p>");
//! ```
//!
//! `{{ value }}` is always HTML-escaped. `{{{ value }}}` emits a string
//! verbatim and must only receive content you trust.
//!
//! # Diagnostics
//!
//! Failures are returned as `Vec<`[`Diagnostic`]`>` carrying a code
//! (`FVxxxx`), severity, line, column and byte span; they never panic. Use
//! [`DiagnosticFormatter`] for human or JSON output with your own display name.

pub mod ast;
pub mod codegen;
pub mod cursor;
pub mod diagnostics;
mod javascript;
pub mod parser;
pub mod static_html;
mod validation;

pub use cursor::CursorPosition;
pub use diagnostics::Diagnostic;
pub use diagnostics::{DiagnosticCode, DiagnosticFormatter, DiagnosticSeverity};
pub use static_html::{
    compile_static, render_static, CompiledStaticTemplate, StaticCompileOptions,
    StaticRenderOptions, StaticRenderOutput,
};

/// Options that control code generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileOptions {
    pub filename: Option<String>,
    pub runtime_import: String,
}

impl CompileOptions {
    pub fn new(runtime_import: impl Into<String>) -> Self {
        Self {
            filename: None,
            runtime_import: runtime_import.into(),
        }
    }

    pub fn with_filename(mut self, filename: impl Into<String>) -> Self {
        self.filename = Some(filename.into());
        self
    }
}

/// The successful result of compiling a template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileOutput {
    pub code: String,
    pub warnings: Vec<Diagnostic>,
}

/// Compile a flowview template into a JavaScript render function.
pub fn compile(source: &str, options: CompileOptions) -> Result<CompileOutput, Vec<Diagnostic>> {
    let root = parser::parse(source)?;
    let warnings = validation::validate(&root, source);
    let code = codegen::generate(&root, &options);
    Ok(CompileOutput { code, warnings })
}

/// Parse a flowview template into its AST without generating code.
pub fn parse_ast(source: &str) -> Result<ast::RootNode, Vec<Diagnostic>> {
    parser::parse(source)
}
