use serde::Serialize;

use crate::cursor::{Cursor, CursorPosition};

/// Severity level of a compilation diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

/// Structured error codes used by the compiler.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticCode {
    InvalidSyntax,
    UnexpectedToken,
    ExpectedToken,
    UnclosedInterpolation,
    EmptyInterpolation,
    UnclosedExpression,
    EmptyExpression,
    UnclosedBlock,
    InvalidForSyntax,
    InvalidBinding,
    InvalidJavaScriptExpression,
    InvalidAttribute,
    InvalidHtml,
    ReservedBinding,
}

impl DiagnosticCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidSyntax => "FM0001",
            Self::UnexpectedToken => "FM0002",
            Self::ExpectedToken => "FM0003",
            Self::UnclosedInterpolation => "FM0004",
            Self::EmptyInterpolation => "FM0005",
            Self::UnclosedExpression => "FM0006",
            Self::EmptyExpression => "FM0007",
            Self::UnclosedBlock => "FM0008",
            Self::InvalidForSyntax => "FM0009",
            Self::InvalidBinding => "FM0010",
            Self::InvalidJavaScriptExpression => "FM0011",
            Self::InvalidAttribute => "FM0012",
            Self::InvalidHtml => "FM0013",
            Self::ReservedBinding => "FM0014",
        }
    }
}

/// A single compilation diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub message: String,
    pub severity: DiagnosticSeverity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub line: usize,
    pub column: usize,
    pub start: usize,
    pub end: usize,
}

impl Diagnostic {
    pub fn new(
        message: impl Into<String>,
        line: usize,
        column: usize,
        start: usize,
        end: usize,
    ) -> Self {
        Self {
            message: message.into(),
            severity: DiagnosticSeverity::Error,
            code: None,
            line,
            column,
            start,
            end,
        }
    }

    pub fn with_severity(mut self, severity: DiagnosticSeverity) -> Self {
        self.severity = severity;
        self
    }

    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.code = Some(code.into());
        self
    }

    pub fn with_diagnostic_code(mut self, code: DiagnosticCode) -> Self {
        self.code = Some(code.as_str().to_string());
        self
    }

    /// Build a diagnostic from byte offsets in the original source.
    pub fn from_source(message: impl Into<String>, source: &str, start: usize, end: usize) -> Self {
        let safe_start = start.min(source.len());
        let safe_end = end.max(safe_start).min(source.len());
        let (line, column) = line_and_column(source, safe_start);

        Self::new(message, line, column, safe_start, safe_end)
    }

    /// Build a diagnostic from a cursor snapshot taken at the start of the offending token.
    pub fn at_cursor(message: impl Into<String>, cursor: &CursorPosition) -> Self {
        Self::new(
            message,
            cursor.line,
            cursor.column,
            cursor.position,
            cursor.position,
        )
    }

    /// Update the end of the diagnostic to the current cursor position.
    pub fn to_cursor(mut self, cursor: &Cursor<'_>) -> Self {
        self.end = cursor.position();
        self
    }

    pub fn to_position(mut self, end: usize) -> Self {
        self.end = end;
        self
    }
}

fn line_and_column(source: &str, offset: usize) -> (usize, usize) {
    let mut line = 1;
    let mut column = 1;

    for character in source[..offset].chars() {
        if character == '\n' {
            line += 1;
            column = 1;
        } else {
            column += 1;
        }
    }

    (line, column)
}

/// Formatter for diagnostics used by integrations (CLI, Vite, Astro).
pub struct DiagnosticFormatter<'a> {
    diagnostics: &'a [Diagnostic],
    filename: &'a str,
    line_offset: usize,
}

impl<'a> DiagnosticFormatter<'a> {
    pub fn new(diagnostics: &'a [Diagnostic], filename: &'a str, line_offset: usize) -> Self {
        Self {
            diagnostics,
            filename,
            line_offset,
        }
    }

    pub fn format_human(&self) -> String {
        let mut output = String::new();
        for diagnostic in self.diagnostics {
            let severity = self.severity_name(diagnostic.severity);
            let code = diagnostic
                .code
                .as_ref()
                .map(|code| format!("[{}] ", code))
                .unwrap_or_default();
            output.push_str(&format!(
                "{}:{}:{}: {}{}: {}\n",
                self.filename,
                diagnostic.line + self.line_offset,
                diagnostic.column,
                severity,
                code,
                diagnostic.message
            ));
        }
        output
    }

    pub fn format_json(&self) -> String {
        let diagnostics: Vec<_> = self
            .diagnostics
            .iter()
            .map(|diagnostic| DiagnosticView {
                message: diagnostic.message.clone(),
                severity: severity_name(diagnostic.severity).to_string(),
                code: diagnostic.code.clone(),
                filename: self.filename.to_string(),
                line: diagnostic.line + self.line_offset,
                column: diagnostic.column,
                start: diagnostic.start,
                end: diagnostic.end,
            })
            .collect();
        serde_json::json!({ "diagnostics": diagnostics }).to_string()
    }

    fn severity_name(&self, severity: DiagnosticSeverity) -> &'static str {
        severity_name(severity)
    }
}

#[derive(Debug, Clone, Serialize)]
struct DiagnosticView {
    message: String,
    severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    filename: String,
    line: usize,
    column: usize,
    start: usize,
    end: usize,
}

pub(crate) fn severity_name(severity: DiagnosticSeverity) -> &'static str {
    match severity {
        DiagnosticSeverity::Error => "error",
        DiagnosticSeverity::Warning => "warning",
    }
}
