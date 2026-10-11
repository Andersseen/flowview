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
    TrackIgnored,
    StaticUnsupportedExpression,
    StaticUnresolvedIdentifier,
    StaticInvalidMemberAccess,
    StaticInvalidIterable,
    StaticUnsupportedValue,
    StaticInvalidContext,
    RawInterpolationUnsupportedLocation,
    EmptyRawInterpolation,
    UnclosedRawInterpolation,
    StaticInvalidRawValue,
}

impl DiagnosticCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidSyntax => "FV0001",
            Self::UnexpectedToken => "FV0002",
            Self::ExpectedToken => "FV0003",
            Self::UnclosedInterpolation => "FV0004",
            Self::EmptyInterpolation => "FV0005",
            Self::UnclosedExpression => "FV0006",
            Self::EmptyExpression => "FV0007",
            Self::UnclosedBlock => "FV0008",
            Self::InvalidForSyntax => "FV0009",
            Self::InvalidBinding => "FV0010",
            Self::InvalidJavaScriptExpression => "FV0011",
            Self::InvalidAttribute => "FV0012",
            Self::InvalidHtml => "FV0013",
            Self::ReservedBinding => "FV0014",
            Self::TrackIgnored => "FV0015",
            Self::StaticUnsupportedExpression => "FV0016",
            Self::StaticUnresolvedIdentifier => "FV0017",
            Self::StaticInvalidMemberAccess => "FV0018",
            Self::StaticInvalidIterable => "FV0019",
            Self::StaticUnsupportedValue => "FV0020",
            Self::StaticInvalidContext => "FV0021",
            Self::RawInterpolationUnsupportedLocation => "FV0022",
            Self::EmptyRawInterpolation => "FV0023",
            Self::UnclosedRawInterpolation => "FV0024",
            Self::StaticInvalidRawValue => "FV0025",
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
    ///
    /// Start and end are snapped to UTF-8 character boundaries and clamped, so the result always
    /// satisfies `start <= end <= source.len()` on UTF-8 character boundaries.
    pub fn from_source(message: impl Into<String>, source: &str, start: usize, end: usize) -> Self {
        let (start, end) = normalize_span(source, start, end);
        let (line, column) = line_and_column(source, start);

        Self::new(message, line, column, start, end)
    }

    /// Re-normalize the span against `source`, recomputing the line and column
    /// only when the start had to move. Applied where diagnostics leave the
    /// parser, because `to_position` and `to_cursor`
    /// do not know the source.
    pub(crate) fn normalized_for(mut self, source: &str) -> Self {
        let (start, end) = normalize_span(source, self.start, self.end);
        if start != self.start {
            (self.line, self.column) = line_and_column(source, start);
        }
        self.start = start;
        self.end = end;
        self
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

/// Normalize a byte span so it is a valid slice range of `source`.
///
/// Both offsets are clamped to `source.len()` and `end` is raised to `start`
/// if it is smaller. An offset inside a multibyte character is then snapped
/// outward so the span still covers the whole offending character: `start`
/// moves back to the character's first byte and `end` forward past its last
/// byte. A zero-width span stays zero-width and snaps back to the character
/// start. ASCII offsets are never changed.
pub(crate) fn normalize_span(source: &str, start: usize, end: usize) -> (usize, usize) {
    let floored = floor_char_boundary(source, start);
    let end = if end <= start {
        floored
    } else {
        ceil_char_boundary(source, end)
    };
    (floored, end)
}

fn floor_char_boundary(source: &str, offset: usize) -> usize {
    let mut offset = offset.min(source.len());
    while !source.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

fn ceil_char_boundary(source: &str, offset: usize) -> usize {
    let mut offset = offset.min(source.len());
    while !source.is_char_boundary(offset) {
        offset += 1;
    }
    offset
}

/// Line and character-based column (both 1-based) of a byte offset. The offset
/// is snapped back to a character boundary instead of panicking.
fn line_and_column(source: &str, offset: usize) -> (usize, usize) {
    let offset = floor_char_boundary(source, offset);
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 1-byte, 2-byte (é), 3-byte (€), 4-byte (🙂) and U+FFFD (3-byte) characters.
    const MIXED: &str = "aé€🙂�z";

    fn assert_valid(source: &str, diagnostic: &Diagnostic) {
        assert!(diagnostic.start <= diagnostic.end, "{diagnostic:?}");
        assert!(diagnostic.end <= source.len(), "{diagnostic:?}");
        assert!(source.is_char_boundary(diagnostic.start), "{diagnostic:?}");
        assert!(source.is_char_boundary(diagnostic.end), "{diagnostic:?}");
    }

    #[test]
    fn every_offset_pair_normalizes_to_char_boundaries() {
        let max = MIXED.len() + 3;
        for start in 0..=max {
            for end in 0..=max {
                let diagnostic = Diagnostic::from_source("x", MIXED, start, end);
                assert_valid(MIXED, &diagnostic);
            }
        }
    }

    #[test]
    fn extreme_offsets_do_not_panic() {
        let diagnostic = Diagnostic::from_source("x", MIXED, usize::MAX, usize::MAX);
        assert_valid(MIXED, &diagnostic);
        assert_eq!(
            (diagnostic.start, diagnostic.end),
            (MIXED.len(), MIXED.len())
        );
        let diagnostic = Diagnostic::from_source("x", "", 3, 9);
        assert_eq!((diagnostic.start, diagnostic.end), (0, 0));
    }

    #[test]
    fn ascii_offsets_are_unchanged() {
        let source = "ab\ncd\nef";
        for start in 0..=source.len() {
            for end in start..=source.len() {
                assert_eq!(normalize_span(source, start, end), (start, end));
            }
        }
        let diagnostic = Diagnostic::from_source("x", source, 4, 7);
        assert_eq!((diagnostic.line, diagnostic.column), (2, 2));
    }

    #[test]
    fn start_snaps_back_and_end_snaps_forward() {
        // a=0, é=1..3, €=3..6, 🙂=6..10, �=10..13, z=13
        assert_eq!(
            normalize_span(MIXED, 2, 2),
            (1, 1),
            "zero-width stays zero-width"
        );
        assert_eq!(normalize_span(MIXED, 2, 4), (1, 6), "different characters");
        assert_eq!(
            normalize_span(MIXED, 7, 9),
            (6, 10),
            "same 4-byte character"
        );
        assert_eq!(normalize_span(MIXED, 11, 12), (10, 13), "U+FFFD");
        assert_eq!(normalize_span(MIXED, 4, 1), (3, 3), "start after end");
        assert_eq!(normalize_span(MIXED, 0, 99), (0, MIXED.len()));
    }

    #[test]
    fn line_and_column_stay_character_based() {
        let diagnostic = Diagnostic::from_source("x", MIXED, 13, 14);
        assert_eq!((diagnostic.line, diagnostic.column), (1, 6));
        // Inside 🙂: reported at the start of that character.
        let diagnostic = Diagnostic::from_source("x", MIXED, 8, 8);
        assert_eq!(
            (diagnostic.start, diagnostic.line, diagnostic.column),
            (6, 1, 4)
        );
        let multiline = "é\n€🙂x";
        let diagnostic =
            Diagnostic::from_source("x", multiline, multiline.len() - 1, multiline.len());
        assert_eq!((diagnostic.line, diagnostic.column), (2, 3));
        assert_eq!(line_and_column(multiline, 4), (2, 1), "defensive snap-back");
    }

    #[test]
    fn normalized_for_fixes_end_only_spans_and_keeps_position() {
        let ascii = Diagnostic::new("x", 1, 2, 1, 2).normalized_for("abc");
        assert_eq!(
            (ascii.line, ascii.column, ascii.start, ascii.end),
            (1, 2, 1, 2)
        );
        let moved = Diagnostic::new("x", 9, 9, 8, 8).normalized_for(MIXED);
        assert_eq!(
            (moved.line, moved.column, moved.start, moved.end),
            (1, 4, 6, 6)
        );
    }
}
