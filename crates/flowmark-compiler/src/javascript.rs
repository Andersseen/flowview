use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::{cursor::Cursor, diagnostics::Diagnostic};

pub(crate) fn validate_expression(
    source: &str,
    expression: &str,
    expression_start: usize,
) -> Result<(), Vec<Diagnostic>> {
    let allocator = Allocator::new();
    let result = Parser::new(&allocator, expression, SourceType::default()).parse_expression();

    match result {
        Ok(_) => Ok(()),
        Err(errors) => {
            let diagnostics = errors
                .into_iter()
                .map(|error| {
                    let label = error.labels.as_slice().first();
                    let relative_start = label.map_or(0, |label| label.offset() as usize);
                    let relative_end = label
                        .map(|label| relative_start + label.len() as usize)
                        .unwrap_or_else(|| expression.len());
                    Diagnostic::from_source(
                        format!("Invalid JavaScript expression: {}", error.message),
                        source,
                        expression_start + relative_start,
                        expression_start + relative_end,
                    )
                    .with_code("FM1001")
                })
                .collect();

            Err(diagnostics)
        }
    }
}

pub(crate) fn find_last_top_level_semicolon(source: &str) -> Option<usize> {
    let mut cursor = Cursor::new(source);
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut brace_depth = 0usize;
    let mut last = None;

    while !cursor.is_eof() {
        if let Some(quote) = current_string_quote(&cursor) {
            skip_string(&mut cursor, quote);
            continue;
        }
        if skip_comment(&mut cursor) {
            continue;
        }
        if cursor.starts_with("/") && is_probable_regex(&cursor, 0) {
            skip_regex(&mut cursor);
            continue;
        }

        match cursor.current() {
            Some('(') => paren_depth += 1,
            Some(')') => paren_depth = paren_depth.saturating_sub(1),
            Some('[') => bracket_depth += 1,
            Some(']') => bracket_depth = bracket_depth.saturating_sub(1),
            Some('{') => brace_depth += 1,
            Some('}') => brace_depth = brace_depth.saturating_sub(1),
            Some(';') if paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 => {
                last = Some(cursor.position());
            }
            _ => {}
        }
        cursor.advance();
    }

    last
}

pub(crate) fn current_string_quote(cursor: &Cursor) -> Option<char> {
    match cursor.current() {
        Some('\'' | '"' | '`') => cursor.current(),
        _ => None,
    }
}

pub(crate) fn skip_string(cursor: &mut Cursor, quote: char) {
    if quote == '`' {
        skip_template(cursor);
        return;
    }

    cursor.advance();

    while let Some(character) = cursor.current() {
        cursor.advance();

        if character == '\\' {
            cursor.advance();
            continue;
        }

        if character == quote {
            break;
        }
    }
}

fn skip_template(cursor: &mut Cursor) {
    cursor.advance();

    while let Some(character) = cursor.current() {
        if character == '\\' {
            cursor.advance();
            cursor.advance();
            continue;
        }

        if character == '`' {
            cursor.advance();
            return;
        }

        if cursor.starts_with("${") {
            cursor.advance_by(2);
            skip_template_expression(cursor);
            continue;
        }

        cursor.advance();
    }
}

fn skip_template_expression(cursor: &mut Cursor) {
    let expression_start = cursor.position();
    let mut brace_depth = 1usize;

    while !cursor.is_eof() && brace_depth > 0 {
        if let Some(quote) = current_string_quote(cursor) {
            skip_string(cursor, quote);
            continue;
        }

        if skip_comment(cursor) {
            continue;
        }

        if cursor.starts_with("/") && is_probable_regex(cursor, expression_start) {
            skip_regex(cursor);
            continue;
        }

        match cursor.current() {
            Some('{') => brace_depth += 1,
            Some('}') => brace_depth -= 1,
            _ => {}
        }
        cursor.advance();
    }
}

pub(crate) fn skip_comment(cursor: &mut Cursor) -> bool {
    if cursor.starts_with("//") {
        cursor.advance_by(2);
        while let Some(character) = cursor.current() {
            cursor.advance();
            if character == '\n' {
                break;
            }
        }
        return true;
    }

    if cursor.starts_with("/*") {
        cursor.advance_by(2);
        while !cursor.is_eof() && !cursor.starts_with("*/") {
            cursor.advance();
        }
        if cursor.starts_with("*/") {
            cursor.advance_by(2);
        }
        return true;
    }

    false
}

pub(crate) fn is_probable_regex(cursor: &Cursor, expression_start: usize) -> bool {
    let before = cursor.slice(expression_start, cursor.position()).trim_end();
    let Some(previous) = before.chars().next_back() else {
        return true;
    };

    if matches!(
        previous,
        '(' | '['
            | '{'
            | ':'
            | ','
            | ';'
            | '='
            | '!'
            | '?'
            | '&'
            | '|'
            | '+'
            | '-'
            | '*'
            | '%'
            | '^'
            | '~'
            | '<'
            | '>'
    ) {
        return true;
    }

    let previous_word = before
        .rsplit(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
        .next()
        .unwrap_or_default();

    matches!(
        previous_word,
        "await"
            | "case"
            | "delete"
            | "do"
            | "else"
            | "in"
            | "instanceof"
            | "new"
            | "of"
            | "return"
            | "throw"
            | "typeof"
            | "void"
            | "yield"
    )
}

pub(crate) fn skip_regex(cursor: &mut Cursor) {
    cursor.advance();
    let mut in_character_class = false;

    while let Some(character) = cursor.current() {
        cursor.advance();
        match character {
            '\\' => {
                cursor.advance();
            }
            '[' => in_character_class = true,
            ']' => in_character_class = false,
            '/' if !in_character_class => break,
            '\n' | '\r' => break,
            _ => {}
        }
    }

    while cursor
        .current()
        .is_some_and(|character| character.is_ascii_alphabetic())
    {
        cursor.advance();
    }
}
