use crate::{
    ast::{ForBlockNode, IfBlockNode, IfBranch, Node, Span, SwitchBlockNode, SwitchCaseNode},
    cursor::{Cursor, CursorPosition},
    diagnostics::{Diagnostic, DiagnosticCode},
    javascript,
};

use super::{
    expressions::{expect_block_close, expect_block_open, parse_parenthesized_expression},
    lexer::{
        matches_keyword, CASE_START, DEFAULT_START, ELSE_IF_START, ELSE_START, EMPTY_START,
        FOR_START, IF_START, SWITCH_START,
    },
    nodes::parse_nodes,
};

pub fn parse_if_block(cursor: &mut Cursor) -> Result<IfBlockNode, Vec<Diagnostic>> {
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
        cursor.skip_whitespace();

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

pub fn parse_for_block(cursor: &mut Cursor) -> Result<ForBlockNode, Vec<Diagnostic>> {
    let start = cursor.position();
    let start_mark = cursor.snapshot();
    cursor.advance_by(FOR_START.len());

    let header = parse_parenthesized_expression(cursor, false)?;
    let (item, iterable, track) = parse_for_header(&header, &start_mark, cursor)?;

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
    cursor.skip_whitespace();

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
    start_mark: &CursorPosition,
    cursor: &Cursor,
) -> Result<(String, String, Option<String>), Vec<Diagnostic>> {
    let trimmed = header.trim();

    let (for_part, track) = match javascript::find_last_top_level_delimiter(trimmed, ';') {
        Some(index) => {
            let track_part = trimmed[index + 1..].trim();
            if !starts_with_track_keyword(track_part) {
                return Err(vec![Diagnostic::at_cursor(
                    "Invalid @for syntax: expected 'track <expression>'",
                    start_mark,
                )
                .with_diagnostic_code(DiagnosticCode::InvalidForSyntax)
                .to_position(cursor.position())]);
            }
            let track = track_part["track".len()..].trim().to_owned();
            (&trimmed[..index], Some(track))
        }
        None => (trimmed, None),
    };

    let for_trimmed = for_part.trim();
    let Some(item_end) = for_trimmed.find(char::is_whitespace) else {
        return Err(vec![invalid_for_diagnostic(start_mark, cursor)]);
    };
    let item = for_trimmed[..item_end].trim().to_owned();
    let after_item = for_trimmed[item_end..].trim_start();
    let Some(after_of) = after_item.strip_prefix("of") else {
        return Err(vec![invalid_for_diagnostic(start_mark, cursor)]);
    };
    if !after_of.chars().next().is_some_and(char::is_whitespace) {
        return Err(vec![invalid_for_diagnostic(start_mark, cursor)]);
    }
    let iterable = after_of.trim().to_owned();

    if item.is_empty() || iterable.is_empty() || !is_valid_binding_identifier(&item) {
        return Err(vec![Diagnostic::at_cursor(
            "Invalid @for binding: expected a non-reserved JavaScript identifier",
            start_mark,
        )
        .with_diagnostic_code(DiagnosticCode::InvalidBinding)
        .to_position(cursor.position())]);
    }

    if let Some(track) = &track {
        if track.trim().is_empty() {
            return Err(vec![Diagnostic::at_cursor(
                "Invalid @for syntax: expected 'track <expression>'",
                start_mark,
            )
            .with_diagnostic_code(DiagnosticCode::InvalidForSyntax)
            .to_position(cursor.position())]);
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

fn invalid_for_diagnostic(start_mark: &CursorPosition, cursor: &Cursor) -> Diagnostic {
    Diagnostic::at_cursor(
        "Invalid @for syntax: expected '<item> of <iterable>'",
        start_mark,
    )
    .with_diagnostic_code(DiagnosticCode::InvalidForSyntax)
    .to_position(cursor.position())
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

pub fn parse_switch_block(cursor: &mut Cursor) -> Result<SwitchBlockNode, Vec<Diagnostic>> {
    let start = cursor.position();
    cursor.advance_by(SWITCH_START.len());

    let expression = parse_parenthesized_expression(cursor, true)?;
    expect_block_open(cursor)?;

    let mut cases = Vec::new();
    let mut default: Option<Vec<Node>> = None;

    loop {
        cursor.skip_whitespace();

        if matches_keyword(cursor, CASE_START) {
            let case_start = cursor.position();
            cursor.advance_by(CASE_START.len());
            let case_expression = parse_parenthesized_expression(cursor, true)?;
            expect_block_open(cursor)?;
            let children = parse_nodes(cursor, &[CASE_START, DEFAULT_START, "}"])?;
            expect_block_close(cursor)?;
            cases.push(SwitchCaseNode {
                expression: case_expression,
                children,
                span: Span {
                    start: case_start,
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
