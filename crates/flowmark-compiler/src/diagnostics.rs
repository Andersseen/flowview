/// Severity level of a compilation diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

/// A single compilation diagnostic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub message: String,
    pub severity: DiagnosticSeverity,
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

    /// Build a diagnostic from byte offsets in the original source.
    pub fn from_source(message: impl Into<String>, source: &str, start: usize, end: usize) -> Self {
        let safe_start = start.min(source.len());
        let safe_end = end.max(safe_start).min(source.len());
        let (line, column) = line_and_column(source, safe_start);

        Self::new(message, line, column, safe_start, safe_end)
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
