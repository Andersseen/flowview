use crate::{
    cursor::Cursor,
    diagnostics::{Diagnostic, DiagnosticCode},
    javascript::{self, ScanMode},
};

/// Parse a parenthesized JavaScript expression, optionally validating it with
/// the JS parser.
pub fn parse_parenthesized_expression(
    cursor: &mut Cursor,
    validate: bool,
) -> Result<String, Vec<Diagnostic>> {
    cursor.skip_whitespace();
    let start_mark = cursor.snapshot();

    if !cursor.starts_with("(") {
        return Err(vec![Diagnostic::at_cursor("Expected '('", &start_mark)
            .with_diagnostic_code(DiagnosticCode::ExpectedToken)
            .to_cursor(cursor)]);
    }

    cursor.advance(); // skip (
    let scan = javascript::scan_balanced_expression(cursor, ScanMode::Parenthesized)
        .map_err(|err| vec![err])?;
    let (expression, leading) = scan.trimmed(cursor.source());

    if expression.is_empty() {
        return Err(vec![Diagnostic::at_cursor(
            "Expression cannot be empty",
            &start_mark,
        )
        .with_diagnostic_code(DiagnosticCode::EmptyExpression)
        .to_position(cursor.position())]);
    }

    if validate {
        javascript::validate_expression(cursor.source(), &expression, scan.start + leading)?;
    }

    cursor.advance(); // skip )

    Ok(expression)
}

/// Expect and consume a `{` at the current cursor position.
pub fn expect_block_open(cursor: &mut Cursor) -> Result<(), Vec<Diagnostic>> {
    cursor.skip_whitespace();
    let start_mark = cursor.snapshot();

    if cursor.starts_with("{") {
        cursor.advance();
        Ok(())
    } else {
        Err(vec![Diagnostic::at_cursor("Expected '{'", &start_mark)
            .with_diagnostic_code(DiagnosticCode::ExpectedToken)
            .to_cursor(cursor)])
    }
}

/// Expect and consume a `}` at the current cursor position.
pub fn expect_block_close(cursor: &mut Cursor) -> Result<(), Vec<Diagnostic>> {
    cursor.skip_whitespace();
    let start_mark = cursor.snapshot();

    if cursor.starts_with("}") {
        cursor.advance();
        Ok(())
    } else {
        Err(vec![Diagnostic::at_cursor("Expected '}'", &start_mark)
            .with_diagnostic_code(DiagnosticCode::ExpectedToken)
            .to_cursor(cursor)])
    }
}
