use crate::{
    ast::{InterpolationNode, Span},
    cursor::Cursor,
    diagnostics::{Diagnostic, DiagnosticCode},
    javascript::{self, ScanMode},
};

/// Parse a `{{ expression }}` interpolation.
pub fn parse_interpolation(cursor: &mut Cursor) -> Result<InterpolationNode, Vec<Diagnostic>> {
    let start = cursor.position();
    let start_mark = cursor.snapshot();
    cursor.advance_by(2); // skip {{

    if is_unquoted_html_tag_interpolation(cursor.source(), start) {
        return Err(vec![Diagnostic::at_cursor(
            "Interpolations inside HTML tags must use a quoted attribute value",
            &start_mark,
        )
        .with_diagnostic_code(DiagnosticCode::InvalidAttribute)
        .to_position(start + 2)]);
    }

    let scan = javascript::scan_balanced_expression(cursor, ScanMode::Interpolation)
        .map_err(|err| vec![err])?;
    let (expression, leading) = scan.trimmed(cursor.source());

    if expression.is_empty() {
        return Err(vec![Diagnostic::at_cursor(
            "Interpolation expression cannot be empty",
            &start_mark,
        )
        .with_diagnostic_code(DiagnosticCode::EmptyInterpolation)
        .to_position(scan.end)]);
    }

    javascript::validate_expression(cursor.source(), &expression, scan.start + leading)?;

    cursor.advance_by(2); // skip }}
    let end = cursor.position();

    Ok(InterpolationNode {
        expression,
        span: Span { start, end },
    })
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
