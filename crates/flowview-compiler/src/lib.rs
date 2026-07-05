pub mod ast;
pub mod codegen;
pub mod cursor;
pub mod diagnostics;
mod javascript;
pub mod parser;
mod validation;

pub use cursor::CursorPosition;
pub use diagnostics::Diagnostic;
pub use diagnostics::{DiagnosticCode, DiagnosticFormatter, DiagnosticSeverity};

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
