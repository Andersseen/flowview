use crate::{
    ast::{InterpolationMode, InterpolationNode, Span},
    cursor::Cursor,
    diagnostics::{Diagnostic, DiagnosticCode},
    javascript::{self, ScanMode},
};

use super::lexer::RAW_INTERPOLATION_START;

/// Parse a `{{ expression }}` or `{{{ expression }}}` interpolation.
///
/// `{{{` is recognized first, so the parser decides the mode exactly once and
/// every backend just reads [`InterpolationNode::mode`].
pub fn parse_interpolation(cursor: &mut Cursor) -> Result<InterpolationNode, Vec<Diagnostic>> {
    let start = cursor.position();
    let start_mark = cursor.snapshot();

    let (mode, open_len, scan_mode) = if cursor.starts_with(RAW_INTERPOLATION_START) {
        (InterpolationMode::Raw, 3, ScanMode::RawInterpolation)
    } else {
        (InterpolationMode::Escaped, 2, ScanMode::Interpolation)
    };
    cursor.advance_by(open_len); // skip {{ or {{{

    if is_unquoted_html_tag_interpolation(cursor.source(), start) {
        return Err(vec![match mode {
            InterpolationMode::Raw => raw_interpolation_in_tag(cursor.source(), start),
            InterpolationMode::Escaped => Diagnostic::at_cursor(
                "Interpolations inside HTML tags must use a quoted attribute value",
                &start_mark,
            )
            .with_diagnostic_code(DiagnosticCode::InvalidAttribute)
            .to_position(start + 2),
        }]);
    }

    let scan = javascript::scan_balanced_expression(cursor, scan_mode).map_err(|err| vec![err])?;
    let (expression, leading) = scan.trimmed(cursor.source());

    if expression.is_empty() {
        let (message, code) = match mode {
            InterpolationMode::Raw => (
                "Raw interpolation expression cannot be empty",
                DiagnosticCode::EmptyRawInterpolation,
            ),
            InterpolationMode::Escaped => (
                "Interpolation expression cannot be empty",
                DiagnosticCode::EmptyInterpolation,
            ),
        };
        return Err(vec![Diagnostic::at_cursor(message, &start_mark)
            .with_diagnostic_code(code)
            .to_position(scan.end)]);
    }

    javascript::validate_expression(cursor.source(), &expression, scan.start + leading)?;

    cursor.advance_by(open_len); // skip }} or }}}
    let end = cursor.position();

    Ok(InterpolationNode {
        expression,
        mode,
        span: Span { start, end },
    })
}

/// Diagnostic for a `{{{` marker found where only escaped interpolation or
/// plain text is allowed: tag names, attribute names and attribute values.
///
/// Raw interpolation is a content feature; allowing it in attributes would
/// silently change attribute-safety semantics.
pub fn raw_interpolation_in_tag(source: &str, start: usize) -> Diagnostic {
    Diagnostic::from_source(
        "Raw interpolation `{{{ ... }}}` is not supported inside HTML tags; use it only in element content",
        source,
        start,
        start + RAW_INTERPOLATION_START.len(),
    )
    .with_diagnostic_code(DiagnosticCode::RawInterpolationUnsupportedLocation)
}

/// Detect interpolation inside an unquoted HTML attribute value.
fn is_unquoted_html_tag_interpolation(source: &str, position: usize) -> bool {
    let before = &source[..position];
    let Some(tag_start) = before.rfind('<') else {
        return false;
    };
    if before.rfind('>').is_some_and(|tag_end| tag_end > tag_start) {
        return false;
    }

    let mut quote = None;
    for ch in source[tag_start..position].chars() {
        match (quote, ch) {
            (None, '\'' | '"') => quote = Some(ch),
            (Some(active), current) if active == current => quote = None,
            _ => {}
        }
    }

    quote.is_none()
}
