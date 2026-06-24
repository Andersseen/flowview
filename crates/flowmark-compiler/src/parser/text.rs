use crate::{ast::*, cursor::Cursor, diagnostics::Diagnostic};

use super::lexer::{is_escaped_syntax, starts_syntax};

/// Parse a run of plain text until a syntax marker is found.
pub fn parse_text(cursor: &mut Cursor) -> Result<TextNode, Vec<Diagnostic>> {
    let start = cursor.position();
    let mut value = String::new();

    loop {
        if cursor.is_eof() {
            break;
        }

        if is_escaped_syntax(cursor) {
            cursor.advance(); // skip escape marker
            value.push(cursor.advance().unwrap());
            continue;
        }

        if starts_syntax(cursor) {
            break;
        }

        value.push(cursor.advance().unwrap());
    }

    Ok(TextNode {
        value,
        span: Span {
            start,
            end: cursor.position(),
        },
    })
}
