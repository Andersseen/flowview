use crate::{
    ast::{Attribute, DynamicAttribute, ElementNode, Node, PlainAttribute, Span, TextNode},
    cursor::{Cursor, CursorPosition},
    diagnostics::{Diagnostic, DiagnosticCode},
    javascript,
};

use super::{lexer::is_escaped_syntax, nodes::parse_nodes};

/// Parse an HTML segment starting with `<`.
pub fn parse_html_segment(cursor: &mut Cursor) -> Result<Vec<Node>, Vec<Diagnostic>> {
    if cursor.starts_with("<!--") {
        return Ok(vec![Node::Text(consume_html_comment(cursor))]);
    }

    if cursor.starts_with_ignore_ascii_case("<!doctype") {
        return Ok(vec![Node::Text(consume_doctype(cursor))]);
    }

    if let Some(tag_name) = raw_text_tag_name(cursor) {
        return Ok(vec![Node::Text(consume_raw_text_element(cursor, tag_name))]);
    }

    parse_element(cursor).map(|node| vec![node])
}

fn parse_element(cursor: &mut Cursor) -> Result<Node, Vec<Diagnostic>> {
    let start = cursor.position();
    cursor.advance(); // skip <

    let tag_name = parse_tag_name(cursor)?;
    let (attributes, self_closing) = parse_attributes(cursor, &tag_name)?;

    if self_closing {
        return Ok(Node::Element(ElementNode {
            tag: tag_name,
            attributes,
            children: Vec::new(),
            self_closing: true,
            span: Span {
                start,
                end: cursor.position(),
            },
        }));
    }

    // Void elements are treated as self-closing even without `/>`.
    if is_void_element(&tag_name) {
        return Ok(Node::Element(ElementNode {
            tag: tag_name,
            attributes,
            children: Vec::new(),
            self_closing: true,
            span: Span {
                start,
                end: cursor.position(),
            },
        }));
    }

    let children = parse_element_children(cursor, &tag_name)?;

    Ok(Node::Element(ElementNode {
        tag: tag_name,
        attributes,
        children,
        self_closing: false,
        span: Span {
            start,
            end: cursor.position(),
        },
    }))
}

fn parse_tag_name(cursor: &mut Cursor) -> Result<String, Vec<Diagnostic>> {
    let start_mark = cursor.snapshot();
    let mut name = String::new();

    while let Some(ch) = cursor.current() {
        if ch.is_ascii_alphabetic() || ch.is_ascii_digit() || ch == '-' || ch == ':' {
            name.push(ch);
            cursor.advance();
        } else {
            break;
        }
    }

    if name.is_empty() {
        return Err(vec![Diagnostic::at_cursor(
            "Expected HTML tag name",
            &start_mark,
        )
        .with_diagnostic_code(DiagnosticCode::InvalidHtml)
        .to_cursor(cursor)]);
    }

    Ok(name.to_ascii_lowercase())
}

fn parse_attributes(
    cursor: &mut Cursor,
    tag_name: &str,
) -> Result<(Vec<Attribute>, bool), Vec<Diagnostic>> {
    let mut attributes = Vec::new();

    loop {
        cursor.skip_whitespace();

        if cursor.starts_with("/>") {
            cursor.advance_by(2);
            return Ok((attributes, true));
        }

        if cursor.starts_with(">") {
            cursor.advance();
            return Ok((attributes, false));
        }

        if cursor.is_eof() {
            return Err(vec![Diagnostic::at_cursor(
                format!("Unclosed tag '<{}'", tag_name),
                &cursor.snapshot(),
            )
            .with_diagnostic_code(DiagnosticCode::InvalidHtml)
            .to_position(cursor.position())]);
        }

        attributes.push(parse_attribute(cursor)?);
    }
}

fn parse_attribute(cursor: &mut Cursor) -> Result<Attribute, Vec<Diagnostic>> {
    let start = cursor.position();
    let start_mark = cursor.snapshot();
    let name = parse_attribute_name(cursor)?;

    cursor.skip_whitespace();

    if !cursor.starts_with("=") {
        return Ok(Attribute::Plain(PlainAttribute {
            name,
            value: None,
            quote: '"',
            span: Span {
                start,
                end: cursor.position(),
            },
        }));
    }

    cursor.advance(); // skip =
    cursor.skip_whitespace();

    let value = parse_attribute_value(cursor, &name, &start_mark)?;

    if let Some(expression) = extract_dynamic_expression(&value.value) {
        let expression_start = value.content_start
            + value.value.find("{{").unwrap_or(0)
            + 2
            + leading_whitespace_after(&value.value, "{{");
        javascript::validate_expression(cursor.source(), &expression, expression_start)?;

        return Ok(Attribute::Dynamic(DynamicAttribute {
            name,
            expression,
            span: Span {
                start,
                end: cursor.position(),
            },
        }));
    }

    if value.has_interpolation_marker {
        let marker_offset = value.value.find("{{").unwrap_or(0);
        return Err(vec![Diagnostic::from_source(
            "Interpolations inside quoted attributes must span the entire attribute value; use a single {{ expression }} or escape the braces",
            cursor.source(),
            value.content_start + marker_offset,
            value.content_start + marker_offset + 2,
        )
        .with_diagnostic_code(DiagnosticCode::InvalidAttribute)]);
    }

    Ok(Attribute::Plain(PlainAttribute {
        name,
        value: Some(value.value),
        quote: value.quote,
        span: Span {
            start,
            end: cursor.position(),
        },
    }))
}

/// If `value` is a quoted string whose entire content is a single
/// interpolation, return the trimmed expression. Otherwise return `None`.
fn extract_dynamic_expression(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if !trimmed.starts_with("{{") || !trimmed.ends_with("}}") {
        return None;
    }

    let inner = &trimmed[2..trimmed.len() - 2].trim();
    if inner.is_empty() {
        return None;
    }

    if !has_balanced_brackets(inner) {
        return None;
    }

    Some(inner.to_string())
}

/// Number of whitespace bytes between the first occurrence of `marker` in
/// `value` and the following non-whitespace character.
fn leading_whitespace_after(value: &str, marker: &str) -> usize {
    let Some(start) = value.find(marker) else {
        return 0;
    };
    let after = &value[start + marker.len()..];
    after.len() - after.trim_start().len()
}

/// Lightweight balance check for parentheses, brackets and braces, ignoring
/// string/comment/regex contents.
fn has_balanced_brackets(source: &str) -> bool {
    let mut cursor = crate::cursor::Cursor::new(source);
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut brace_depth = 0usize;

    while !cursor.is_eof() {
        if let Some(quote) = javascript::current_string_quote(&cursor) {
            javascript::skip_string(&mut cursor, quote);
            continue;
        }
        if javascript::skip_comment(&mut cursor) {
            continue;
        }

        match cursor.current() {
            Some('(') => paren_depth += 1,
            Some(')') => paren_depth = paren_depth.saturating_sub(1),
            Some('[') => bracket_depth += 1,
            Some(']') => bracket_depth = bracket_depth.saturating_sub(1),
            Some('{') => brace_depth += 1,
            Some('}') => brace_depth = brace_depth.saturating_sub(1),
            _ => {}
        }
        cursor.advance();
    }

    paren_depth == 0 && bracket_depth == 0 && brace_depth == 0
}

fn parse_attribute_name(cursor: &mut Cursor) -> Result<String, Vec<Diagnostic>> {
    let start_mark = cursor.snapshot();
    let mut name = String::new();

    while let Some(ch) = cursor.current() {
        if ch.is_ascii_alphabetic() || ch.is_ascii_digit() || ch == '-' || ch == ':' || ch == '_' {
            name.push(ch);
            cursor.advance();
        } else {
            break;
        }
    }

    if name.is_empty() {
        return Err(vec![Diagnostic::at_cursor(
            "Expected attribute name",
            &start_mark,
        )
        .with_diagnostic_code(DiagnosticCode::InvalidAttribute)
        .to_cursor(cursor)]);
    }

    Ok(name.to_ascii_lowercase())
}

struct AttributeValue {
    value: String,
    quote: char,
    /// Byte offset in the original source where the quoted value content starts
    /// (immediately after the opening quote).
    content_start: usize,
    has_interpolation_marker: bool,
}

fn parse_attribute_value(
    cursor: &mut Cursor,
    attr_name: &str,
    attr_start: &CursorPosition,
) -> Result<AttributeValue, Vec<Diagnostic>> {
    let start_mark = cursor.snapshot();

    let quote = match cursor.current() {
        Some('\'' | '"' | '`') => {
            let q = cursor.current().unwrap();
            cursor.advance();
            q
        }
        _ => {
            return parse_unquoted_attribute_value(cursor, attr_name, attr_start);
        }
    };

    let content_start = cursor.position();
    let mut value = String::new();
    let mut has_interpolation_marker = false;

    while let Some(ch) = cursor.current() {
        if is_escaped_syntax(cursor) {
            cursor.advance();
            value.push(cursor.advance().unwrap());
            continue;
        }

        if cursor.starts_with("{{") {
            has_interpolation_marker = true;
        }

        if ch == quote {
            cursor.advance();
            return Ok(AttributeValue {
                value,
                quote,
                content_start,
                has_interpolation_marker,
            });
        }

        value.push(ch);
        cursor.advance();
    }

    Err(vec![Diagnostic::at_cursor(
        format!("Unclosed attribute value for '{}'", attr_name),
        &start_mark,
    )
    .with_diagnostic_code(DiagnosticCode::InvalidAttribute)
    .to_position(cursor.position())])
}

fn parse_unquoted_attribute_value(
    cursor: &mut Cursor,
    attr_name: &str,
    attr_start: &CursorPosition,
) -> Result<AttributeValue, Vec<Diagnostic>> {
    let _start = cursor.position();
    let mut value = String::new();

    while let Some(ch) = cursor.current() {
        if ch.is_whitespace() || ch == '>' || ch == '/' {
            break;
        }

        if cursor.starts_with("{{") {
            return Err(vec![Diagnostic::at_cursor(
                "Interpolations inside HTML tags must use a quoted attribute value",
                attr_start,
            )
            .with_diagnostic_code(DiagnosticCode::InvalidAttribute)
            .to_position(cursor.position() + 2)]);
        }

        value.push(ch);
        cursor.advance();
    }

    if value.is_empty() {
        return Err(vec![Diagnostic::at_cursor(
            format!("Expected attribute value for '{}'", attr_name),
            attr_start,
        )
        .with_diagnostic_code(DiagnosticCode::InvalidAttribute)
        .to_position(cursor.position())]);
    }

    let content_start = cursor.position() - value.len();
    let has_interpolation_marker = value.contains("{{");
    Ok(AttributeValue {
        value,
        quote: '"',
        content_start,
        has_interpolation_marker,
    })
}

fn parse_element_children(
    cursor: &mut Cursor,
    tag_name: &str,
) -> Result<Vec<Node>, Vec<Diagnostic>> {
    let _start = cursor.position();
    let closing = format!("</{}", tag_name);
    let children = parse_nodes(cursor, &[&closing])?;

    if !cursor.starts_with_ignore_ascii_case(&closing) {
        return Err(vec![Diagnostic::at_cursor(
            format!("Expected closing tag '</{}>'", tag_name),
            &cursor.snapshot(),
        )
        .with_diagnostic_code(DiagnosticCode::InvalidHtml)
        .to_position(cursor.position())]);
    }

    cursor.advance_by(closing.len());

    // The closing tag may contain whitespace and an optional `>`.
    while let Some(ch) = cursor.current() {
        if ch == '>' {
            cursor.advance();
            break;
        }
        if ch.is_whitespace() {
            cursor.advance();
        } else {
            break;
        }
    }

    Ok(children)
}

fn is_void_element(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

fn consume_html_comment(cursor: &mut Cursor) -> TextNode {
    let start = cursor.position();
    while !cursor.is_eof() && !cursor.starts_with("-->") {
        cursor.advance();
    }
    if cursor.starts_with("-->") {
        cursor.advance_by(3);
    }

    TextNode {
        value: cursor.slice(start, cursor.position()).to_owned(),
        span: Span {
            start,
            end: cursor.position(),
        },
    }
}

fn consume_doctype(cursor: &mut Cursor) -> TextNode {
    let start = cursor.position();
    while !cursor.is_eof() && cursor.current() != Some('>') {
        cursor.advance();
    }
    if cursor.current() == Some('>') {
        cursor.advance();
    }

    TextNode {
        value: cursor.slice(start, cursor.position()).to_owned(),
        span: Span {
            start,
            end: cursor.position(),
        },
    }
}

fn raw_text_tag_name(cursor: &Cursor) -> Option<&'static str> {
    ["script", "style"].into_iter().find(|name| {
        let remaining = &cursor.source()[cursor.position()..];
        let opening = format!("<{name}");
        remaining
            .get(..opening.len())
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(&opening))
            && remaining[opening.len()..]
                .chars()
                .next()
                .is_some_and(|character| {
                    character.is_whitespace() || matches!(character, '>' | '/')
                })
    })
}

fn consume_raw_text_element(cursor: &mut Cursor, tag_name: &str) -> TextNode {
    let start = cursor.position();
    let closing = format!("</{tag_name}");

    while !cursor.is_eof() {
        let remaining = &cursor.source()[cursor.position()..];
        let is_closing = remaining
            .get(..closing.len())
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(&closing))
            && remaining[closing.len()..]
                .chars()
                .next()
                .is_some_and(|character| character.is_whitespace() || character == '>');

        if is_closing {
            while let Some(character) = cursor.advance() {
                if character == '>' {
                    break;
                }
            }
            break;
        }

        cursor.advance();
    }

    TextNode {
        value: cursor.slice(start, cursor.position()).to_owned(),
        span: Span {
            start,
            end: cursor.position(),
        },
    }
}
