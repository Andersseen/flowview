use crate::{
    ast::{Node, RootNode},
    cursor::Cursor,
    diagnostics::{Diagnostic, DiagnosticCode},
};

use super::{
    blocks::{parse_for_block, parse_if_block, parse_switch_block},
    html::parse_html_segment,
    interpolation::parse_interpolation,
    lexer::{
        match_terminator, match_unexpected_keyword, matches_keyword, FOR_START, IF_START,
        SWITCH_START,
    },
    text::parse_text,
};

/// Parse a full template source into a root node.
pub fn parse(source: &str) -> Result<RootNode, Vec<Diagnostic>> {
    let mut cursor = Cursor::new(source);
    let children = parse_nodes(&mut cursor, &[])?;

    if cursor.is_eof() {
        Ok(RootNode { children })
    } else {
        let start_mark = cursor.snapshot();
        Err(vec![Diagnostic::at_cursor("Unexpected token", &start_mark)
            .with_diagnostic_code(DiagnosticCode::UnexpectedToken)
            .to_position(cursor.position() + 1)])
    }
}

/// Parse a sequence of child nodes until one of the terminator markers is found
/// or the end of the source is reached.
pub fn parse_nodes(
    cursor: &mut Cursor,
    terminators: &[&str],
) -> Result<Vec<Node>, Vec<Diagnostic>> {
    let mut nodes = Vec::new();
    let mut diagnostics = Vec::new();

    loop {
        if cursor.is_eof() {
            break;
        }

        if let Some(_terminator) = match_terminator(cursor, terminators) {
            break;
        }

        if cursor.starts_with("</") {
            let tag_name = read_closing_tag_name(cursor);
            let start_mark = cursor.snapshot();
            cursor.advance_by(2 + tag_name.len());
            diagnostics.push(
                Diagnostic::at_cursor(
                    format!("Unexpected closing tag '</{}>'", tag_name),
                    &start_mark,
                )
                .with_diagnostic_code(DiagnosticCode::UnexpectedToken)
                .to_cursor(cursor),
            );
            continue;
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
            let start_mark = cursor.snapshot();
            cursor.advance();
            diagnostics.push(
                Diagnostic::at_cursor("Unexpected '}'", &start_mark)
                    .with_diagnostic_code(DiagnosticCode::UnexpectedToken)
                    .to_cursor(cursor),
            );
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

        if let Some(keyword) = match_unexpected_keyword(cursor) {
            let start_mark = cursor.snapshot();
            cursor.advance_by(keyword.len());
            diagnostics.push(
                Diagnostic::at_cursor(format!("Unexpected '{}'", keyword), &start_mark)
                    .with_diagnostic_code(DiagnosticCode::UnexpectedToken)
                    .to_cursor(cursor),
            );
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

fn read_closing_tag_name(cursor: &Cursor) -> String {
    let mut name = String::new();
    for ch in cursor.source()[cursor.position() + 2..].chars() {
        if ch.is_ascii_alphabetic() || ch.is_ascii_digit() || ch == '-' || ch == ':' {
            name.push(ch);
        } else {
            break;
        }
    }
    name.to_ascii_lowercase()
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
