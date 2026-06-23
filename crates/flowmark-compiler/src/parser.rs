use crate::{ast::*, cursor::Cursor, diagnostics::Diagnostic, javascript};

const IF_START: &str = "@if";
const ELSE_IF_START: &str = "@else if";
const ELSE_START: &str = "@else";
const FOR_START: &str = "@for";
const EMPTY_START: &str = "@empty";
const SWITCH_START: &str = "@switch";
const CASE_START: &str = "@case";
const DEFAULT_START: &str = "@default";

/// Parse a full template source into a root node.
pub fn parse(source: &str) -> Result<RootNode, Vec<Diagnostic>> {
    let mut cursor = Cursor::new(source);
    let children = parse_nodes(&mut cursor, &[])?;

    if cursor.is_eof() {
        Ok(RootNode { children })
    } else {
        Err(vec![Diagnostic::new(
            "Unexpected token",
            cursor.line(),
            cursor.column(),
            cursor.position(),
            cursor.position() + 1,
        )])
    }
}

/// Parse a sequence of child nodes until one of the terminator markers is found
/// or the end of the source is reached.
fn parse_nodes(cursor: &mut Cursor, terminators: &[&str]) -> Result<Vec<Node>, Vec<Diagnostic>> {
    let mut nodes = Vec::new();
    let mut diagnostics = Vec::new();

    loop {
        if cursor.is_eof() {
            break;
        }

        if cursor.starts_with("<") {
            match parse_html_segment(cursor) {
                Ok(html_nodes) => {
                    for node in html_nodes {
                        push_node(&mut nodes, node);
                    }
                }
                Err(errors) => diagnostics.extend(errors),
            }
            continue;
        }

        if cursor.starts_with("}") {
            if terminators.contains(&"}") {
                break;
            }
            let start = cursor.position();
            cursor.advance();
            diagnostics.push(Diagnostic::new(
                "Unexpected '}'",
                cursor.line(),
                cursor.column(),
                start,
                cursor.position(),
            ));
            continue;
        }

        if cursor.starts_with("{{") {
            match parse_interpolation(cursor) {
                Ok(node) => nodes.push(Node::Interpolation(node)),
                Err(err) => diagnostics.extend(err),
            }
            continue;
        }

        if matches_keyword(cursor, IF_START) {
            match parse_if_block(cursor) {
                Ok(node) => nodes.push(Node::IfBlock(node)),
                Err(err) => diagnostics.extend(err),
            }
            continue;
        }

        if matches_keyword(cursor, FOR_START) {
            match parse_for_block(cursor) {
                Ok(node) => nodes.push(Node::ForBlock(node)),
                Err(err) => diagnostics.extend(err),
            }
            continue;
        }

        if matches_keyword(cursor, SWITCH_START) {
            match parse_switch_block(cursor) {
                Ok(node) => nodes.push(Node::SwitchBlock(node)),
                Err(err) => diagnostics.extend(err),
            }
            continue;
        }

        if let Some(_terminator) = match_terminator(cursor, terminators) {
            break;
        }

        if let Some(keyword) = match_unexpected_keyword(cursor) {
            let start = cursor.position();
            cursor.advance_by(keyword.len());
            diagnostics.push(Diagnostic::new(
                format!("Unexpected '{}'", keyword),
                cursor.line(),
                cursor.column(),
                start,
                cursor.position(),
            ));
            continue;
        }

        match parse_text(cursor) {
            Ok(node) => {
                if !node.value.is_empty() {
                    push_node(&mut nodes, Node::Text(node));
                }
            }
            Err(err) => diagnostics.extend(err),
        }
    }

    if !diagnostics.is_empty() {
        return Err(diagnostics);
    }

    Ok(nodes)
}

fn push_node(nodes: &mut Vec<Node>, node: Node) {
    if let Node::Text(next) = node {
        if let Some(Node::Text(previous)) = nodes.last_mut() {
            previous.value.push_str(&next.value);
            previous.span.end = next.span.end;
            return;
        }
        nodes.push(Node::Text(next));
        return;
    }

    nodes.push(node);
}

fn match_terminator<'a>(cursor: &Cursor, terminators: &[&'a str]) -> Option<&'a str> {
    terminators
        .iter()
        .copied()
        .find(|terminator| matches_marker(cursor, terminator))
}

fn match_unexpected_keyword(cursor: &Cursor) -> Option<&'static str> {
    let keywords = [
        ELSE_IF_START,
        ELSE_START,
        EMPTY_START,
        CASE_START,
        DEFAULT_START,
    ];
    keywords
        .iter()
        .copied()
        .find(|keyword| matches_keyword(cursor, keyword))
}

fn parse_interpolation(cursor: &mut Cursor) -> Result<InterpolationNode, Vec<Diagnostic>> {
    let start = cursor.position();
    let start_line = cursor.line();
    let start_column = cursor.column();
    cursor.advance_by(2); // skip {{

    if is_unquoted_html_tag_interpolation(cursor.source(), start) {
        return Err(vec![Diagnostic::new(
            "Interpolations inside HTML tags must use a quoted attribute value",
            start_line,
            start_column,
            start,
            start + 2,
        )]);
    }

    let expression_start = cursor.position();
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut brace_depth = 0usize;

    while !cursor.is_eof() {
        if cursor.starts_with("}}") && paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 {
            break;
        }

        if let Some(quote) = javascript::current_string_quote(cursor) {
            javascript::skip_string(cursor, quote);
            continue;
        }

        if javascript::skip_comment(cursor) {
            continue;
        }

        if cursor.starts_with("/") && javascript::is_probable_regex(cursor, expression_start) {
            javascript::skip_regex(cursor);
            continue;
        }

        match cursor.current() {
            Some('(') => paren_depth += 1,
            Some(')') => paren_depth = paren_depth.saturating_sub(1),
            Some('[') => bracket_depth += 1,
            Some(']') => bracket_depth = bracket_depth.saturating_sub(1),
            Some('{') => brace_depth += 1,
            Some('}') if brace_depth > 0 => brace_depth -= 1,
            _ => {}
        }

        cursor.advance();
    }

    if cursor.is_eof() {
        return Err(vec![Diagnostic::new(
            "Unclosed interpolation",
            cursor.line(),
            cursor.column(),
            start,
            cursor.position(),
        )]);
    }

    let raw_expression = cursor.slice(expression_start, cursor.position());
    let leading_whitespace = raw_expression.len() - raw_expression.trim_start().len();
    let expression = raw_expression.trim().to_owned();

    if expression.is_empty() {
        return Err(vec![Diagnostic::new(
            "Interpolation expression cannot be empty",
            cursor.line(),
            cursor.column(),
            expression_start,
            cursor.position(),
        )]);
    }

    javascript::validate_expression(
        cursor.source(),
        &expression,
        expression_start + leading_whitespace,
    )?;

    cursor.advance_by(2); // skip }}
    let end = cursor.position();

    Ok(InterpolationNode {
        expression,
        span: Span { start, end },
    })
}

fn parse_html_segment(cursor: &mut Cursor) -> Result<Vec<Node>, Vec<Diagnostic>> {
    if cursor.starts_with("<!--") {
        return Ok(vec![Node::Text(consume_html_comment(cursor))]);
    }

    if let Some(tag_name) = raw_text_tag_name(cursor) {
        return Ok(vec![Node::Text(consume_raw_text_element(cursor, tag_name))]);
    }

    let mut nodes = Vec::new();
    let mut text = String::new();
    let mut text_start = cursor.position();
    let mut quote = None;

    while !cursor.is_eof() {
        if cursor.starts_with("{{") {
            push_text_node(&mut nodes, &mut text, text_start, cursor.position());
            nodes.push(Node::Interpolation(parse_interpolation(cursor)?));
            text_start = cursor.position();
            continue;
        }

        if is_escaped_syntax(cursor) {
            cursor.advance();
            if let Some(character) = cursor.advance() {
                text.push(character);
            }
            continue;
        }

        let Some(character) = cursor.advance() else {
            break;
        };
        text.push(character);

        match (quote, character) {
            (None, '\'' | '"' | '`') => quote = Some(character),
            (Some(active), current) if active == current => quote = None,
            (None, '>') => break,
            _ => {}
        }
    }

    push_text_node(&mut nodes, &mut text, text_start, cursor.position());
    Ok(nodes)
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

fn push_text_node(nodes: &mut Vec<Node>, text: &mut String, start: usize, end: usize) {
    if text.is_empty() {
        return;
    }

    nodes.push(Node::Text(TextNode {
        value: std::mem::take(text),
        span: Span { start, end },
    }));
}

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

fn parse_text(cursor: &mut Cursor) -> Result<TextNode, Vec<Diagnostic>> {
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

fn parse_if_block(cursor: &mut Cursor) -> Result<IfBlockNode, Vec<Diagnostic>> {
    let start = cursor.position();
    cursor.advance_by(IF_START.len());

    let condition = parse_parenthesized_expression(cursor, true)?;
    expect_block_open(cursor)?;

    let first_branch_children = parse_nodes(cursor, &["}"])?;
    expect_block_close(cursor)?;
    let mut branches = vec![IfBranch {
        condition,
        children: first_branch_children,
        span: Span {
            start,
            end: cursor.position(),
        },
    }];

    let mut else_branch: Option<Vec<Node>> = None;

    loop {
        let continuation_start = cursor.clone();
        skip_whitespace(cursor);

        if matches_keyword(cursor, ELSE_IF_START) {
            let branch_start = cursor.position();
            cursor.advance_by(ELSE_IF_START.len());
            let condition = parse_parenthesized_expression(cursor, true)?;
            expect_block_open(cursor)?;
            let children = parse_nodes(cursor, &["}"])?;
            expect_block_close(cursor)?;
            branches.push(IfBranch {
                condition,
                children,
                span: Span {
                    start: branch_start,
                    end: cursor.position(),
                },
            });
            continue;
        }

        if matches_keyword(cursor, ELSE_START) {
            cursor.advance_by(ELSE_START.len());
            expect_block_open(cursor)?;
            else_branch = Some(parse_nodes(cursor, &["}"])?);
            expect_block_close(cursor)?;
            break;
        }

        // Whitespace belongs to the rendered template unless it separates a
        // control-flow continuation such as `} @else {`.
        *cursor = continuation_start;
        break;
    }

    let end = cursor.position();

    Ok(IfBlockNode {
        branches,
        else_branch,
        span: Span { start, end },
    })
}

fn parse_for_block(cursor: &mut Cursor) -> Result<ForBlockNode, Vec<Diagnostic>> {
    let start = cursor.position();
    cursor.advance_by(FOR_START.len());

    let header = parse_parenthesized_expression(cursor, false)?;
    let (item, iterable, track) = parse_for_header(&header, start, cursor)?;

    let header_start = cursor.source()[start..cursor.position()]
        .find(&header)
        .map_or(start, |offset| start + offset);
    let iterable_start = header
        .find(&iterable)
        .map_or(header_start, |offset| header_start + offset);
    javascript::validate_expression(cursor.source(), &iterable, iterable_start)?;
    if let Some(track_expression) = &track {
        let track_start = header
            .rfind(track_expression)
            .map_or(header_start, |offset| header_start + offset);
        javascript::validate_expression(cursor.source(), track_expression, track_start)?;
    }

    expect_block_open(cursor)?;
    let children = parse_nodes(cursor, &["}"])?;
    expect_block_close(cursor)?;

    let continuation_start = cursor.clone();
    skip_whitespace(cursor);

    let empty = if matches_keyword(cursor, EMPTY_START) {
        cursor.advance_by(EMPTY_START.len());
        expect_block_open(cursor)?;
        let empty_children = parse_nodes(cursor, &["}"])?;
        expect_block_close(cursor)?;
        Some(empty_children)
    } else {
        // Keep whitespace after a complete loop when there is no `@empty`
        // continuation. It is observable HTML and must not be trimmed.
        *cursor = continuation_start;
        None
    };

    let end = cursor.position();

    Ok(ForBlockNode {
        item,
        iterable,
        track,
        children,
        empty,
        span: Span { start, end },
    })
}

fn parse_for_header(
    header: &str,
    start: usize,
    cursor: &Cursor,
) -> Result<(String, String, Option<String>), Vec<Diagnostic>> {
    let trimmed = header.trim();

    let (for_part, track) = match javascript::find_last_top_level_semicolon(trimmed) {
        Some(index) => {
            let track_part = trimmed[index + 1..].trim();
            if !starts_with_track_keyword(track_part) {
                return Err(vec![Diagnostic::new(
                    "Invalid @for syntax: expected 'track <expression>'",
                    cursor.line(),
                    cursor.column(),
                    start,
                    cursor.position(),
                )]);
            }
            let track = track_part["track".len()..].trim().to_owned();
            (&trimmed[..index], Some(track))
        }
        None => (trimmed, None),
    };

    let for_trimmed = for_part.trim();
    let Some(item_end) = for_trimmed.find(char::is_whitespace) else {
        return Err(vec![invalid_for_diagnostic(start, cursor)]);
    };
    let item = for_trimmed[..item_end].trim().to_owned();
    let after_item = for_trimmed[item_end..].trim_start();
    let Some(after_of) = after_item.strip_prefix("of") else {
        return Err(vec![invalid_for_diagnostic(start, cursor)]);
    };
    if !after_of.chars().next().is_some_and(char::is_whitespace) {
        return Err(vec![invalid_for_diagnostic(start, cursor)]);
    }
    let iterable = after_of.trim().to_owned();

    if item.is_empty() || iterable.is_empty() || !is_valid_binding_identifier(&item) {
        return Err(vec![Diagnostic::new(
            "Invalid @for binding: expected a non-reserved JavaScript identifier",
            cursor.line(),
            cursor.column(),
            start,
            cursor.position(),
        )]);
    }

    if let Some(track) = &track {
        if track.trim().is_empty() {
            return Err(vec![Diagnostic::new(
                "Invalid @for syntax: expected 'track <expression>'",
                cursor.line(),
                cursor.column(),
                start,
                cursor.position(),
            )]);
        }
    }

    Ok((item, iterable, track))
}

fn starts_with_track_keyword(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("track") else {
        return false;
    };

    rest.chars().next().is_some_and(char::is_whitespace)
}

fn invalid_for_diagnostic(start: usize, cursor: &Cursor) -> Diagnostic {
    Diagnostic::new(
        "Invalid @for syntax: expected '<item> of <iterable>'",
        cursor.line(),
        cursor.column(),
        start,
        cursor.position(),
    )
}

fn is_valid_binding_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_' || first == '$')
        || !chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '$')
    {
        return false;
    }

    const RESERVED: &[&str] = &[
        "await",
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "context",
        "debugger",
        "default",
        "delete",
        "do",
        "else",
        "enum",
        "export",
        "extends",
        "false",
        "finally",
        "for",
        "function",
        "if",
        "import",
        "in",
        "instanceof",
        "let",
        "new",
        "null",
        "output",
        "renderValue",
        "return",
        "static",
        "super",
        "switch",
        "this",
        "throw",
        "true",
        "try",
        "typeof",
        "var",
        "void",
        "while",
        "with",
        "yield",
    ];

    !value.starts_with("__") && !RESERVED.contains(&value)
}

fn parse_switch_block(cursor: &mut Cursor) -> Result<SwitchBlockNode, Vec<Diagnostic>> {
    let start = cursor.position();
    cursor.advance_by(SWITCH_START.len());

    let expression = parse_parenthesized_expression(cursor, true)?;
    expect_block_open(cursor)?;

    let mut cases = Vec::new();
    let mut default: Option<Vec<Node>> = None;

    loop {
        skip_whitespace(cursor);

        if matches_keyword(cursor, CASE_START) {
            cursor.advance_by(CASE_START.len());
            let case_expression = parse_parenthesized_expression(cursor, true)?;
            expect_block_open(cursor)?;
            let children = parse_nodes(cursor, &[CASE_START, DEFAULT_START, "}"])?;
            expect_block_close(cursor)?;
            cases.push(SwitchCaseNode {
                expression: case_expression,
                children,
                span: Span {
                    start,
                    end: cursor.position(),
                },
            });
            continue;
        }

        if matches_keyword(cursor, DEFAULT_START) {
            cursor.advance_by(DEFAULT_START.len());
            expect_block_open(cursor)?;
            default = Some(parse_nodes(cursor, &[CASE_START, DEFAULT_START, "}"])?);
            expect_block_close(cursor)?;
            break;
        }

        if cursor.starts_with("}") {
            break;
        }

        break;
    }

    expect_block_close(cursor)?;
    let end = cursor.position();

    Ok(SwitchBlockNode {
        expression,
        cases,
        default,
        span: Span { start, end },
    })
}

fn parse_parenthesized_expression(
    cursor: &mut Cursor,
    validate: bool,
) -> Result<String, Vec<Diagnostic>> {
    skip_whitespace(cursor);
    let start = cursor.position();

    if !cursor.starts_with("(") {
        return Err(vec![Diagnostic::new(
            "Expected '('",
            cursor.line(),
            cursor.column(),
            start,
            cursor.position(),
        )]);
    }

    cursor.advance(); // skip (
    let expression_start = cursor.position();
    let mut depth = 1;

    while !cursor.is_eof() && depth > 0 {
        let ch = cursor.current().unwrap();

        if let Some(quote) = javascript::current_string_quote(cursor) {
            javascript::skip_string(cursor, quote);
            continue;
        }

        if javascript::skip_comment(cursor) {
            continue;
        }

        if cursor.starts_with("/") && javascript::is_probable_regex(cursor, expression_start) {
            javascript::skip_regex(cursor);
            continue;
        }

        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }

        cursor.advance();
    }

    if depth != 0 {
        return Err(vec![Diagnostic::new(
            "Unclosed expression",
            cursor.line(),
            cursor.column(),
            start,
            cursor.position(),
        )]);
    }

    let raw_expression = cursor.slice(expression_start, cursor.position() - 1);
    let leading_whitespace = raw_expression.len() - raw_expression.trim_start().len();
    let expression = raw_expression.trim().to_owned();

    if expression.is_empty() {
        return Err(vec![Diagnostic::new(
            "Expression cannot be empty",
            cursor.line(),
            cursor.column(),
            expression_start,
            cursor.position().saturating_sub(1),
        )]);
    }

    if validate {
        javascript::validate_expression(
            cursor.source(),
            &expression,
            expression_start + leading_whitespace,
        )?;
    }

    Ok(expression)
}

fn expect_block_open(cursor: &mut Cursor) -> Result<(), Vec<Diagnostic>> {
    skip_whitespace(cursor);
    let start = cursor.position();

    if cursor.starts_with("{") {
        cursor.advance();
        Ok(())
    } else {
        Err(vec![Diagnostic::new(
            "Expected '{'",
            cursor.line(),
            cursor.column(),
            start,
            cursor.position(),
        )])
    }
}

fn expect_block_close(cursor: &mut Cursor) -> Result<(), Vec<Diagnostic>> {
    skip_whitespace(cursor);
    let start = cursor.position();

    if cursor.starts_with("}") {
        cursor.advance();
        Ok(())
    } else {
        Err(vec![Diagnostic::new(
            "Expected '}'",
            cursor.line(),
            cursor.column(),
            start,
            cursor.position(),
        )])
    }
}

fn skip_whitespace(cursor: &mut Cursor) {
    while let Some(ch) = cursor.current() {
        if ch.is_whitespace() {
            cursor.advance();
        } else {
            break;
        }
    }
}

fn starts_syntax(cursor: &Cursor) -> bool {
    cursor.starts_with("<")
        || cursor.starts_with("{{")
        || cursor.starts_with("}")
        || matches_keyword(cursor, IF_START)
        || matches_keyword(cursor, FOR_START)
        || matches_keyword(cursor, SWITCH_START)
        || matches_keyword(cursor, ELSE_IF_START)
        || matches_keyword(cursor, ELSE_START)
        || matches_keyword(cursor, EMPTY_START)
        || matches_keyword(cursor, CASE_START)
        || matches_keyword(cursor, DEFAULT_START)
}

fn matches_marker(cursor: &Cursor, marker: &str) -> bool {
    if marker == "}" {
        cursor.starts_with(marker)
    } else {
        matches_keyword(cursor, marker)
    }
}

fn matches_keyword(cursor: &Cursor, keyword: &str) -> bool {
    if !cursor.starts_with(keyword) {
        return false;
    }

    let previous = cursor.source()[..cursor.position()].chars().next_back();
    if matches!(previous, Some(character) if character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return false;
    }

    let next = cursor.source()[cursor.position() + keyword.len()..]
        .chars()
        .next();

    !matches!(next, Some(ch) if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn is_escaped_syntax(cursor: &Cursor) -> bool {
    cursor.starts_with("\\") && matches!(cursor.peek(1), Some('@' | '{' | '}' | '\\'))
}
