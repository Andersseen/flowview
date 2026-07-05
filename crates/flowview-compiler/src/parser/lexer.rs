use crate::cursor::Cursor;

pub const IF_START: &str = "@if";
pub const ELSE_IF_START: &str = "@else if";
pub const ELSE_START: &str = "@else";
pub const FOR_START: &str = "@for";
pub const EMPTY_START: &str = "@empty";
pub const SWITCH_START: &str = "@switch";
pub const CASE_START: &str = "@case";
pub const DEFAULT_START: &str = "@default";

/// Check whether the cursor is positioned at the start of a flowview keyword.
/// Keywords must not be preceded or followed by alphanumeric characters or `-`/`_`.
pub fn matches_keyword(cursor: &Cursor, keyword: &str) -> bool {
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

/// Same as `matches_keyword`, but treats `}` and HTML closing tags as literal
/// terminator markers.
pub fn matches_marker(cursor: &Cursor, marker: &str) -> bool {
    if marker == "}" {
        cursor.starts_with(marker)
    } else if marker.starts_with("</") {
        cursor.source()[cursor.position()..]
            .to_ascii_lowercase()
            .starts_with(&marker.to_ascii_lowercase())
    } else {
        matches_keyword(cursor, marker)
    }
}

/// Find the first terminator that matches at the current cursor position.
pub fn match_terminator<'a>(cursor: &Cursor, terminators: &[&'a str]) -> Option<&'a str> {
    terminators
        .iter()
        .copied()
        .find(|terminator| matches_marker(cursor, terminator))
}

/// Find a control-flow keyword that is invalid at the current parsing level.
pub fn match_unexpected_keyword(cursor: &Cursor) -> Option<&'static str> {
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

/// Check whether the cursor is at the start of any syntax marker.
pub fn starts_syntax(cursor: &Cursor) -> bool {
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

/// Check whether the current position is an escaped syntax marker (`\@`, `\{`, `\}`, `\\`).
pub fn is_escaped_syntax(cursor: &Cursor) -> bool {
    cursor.starts_with("\\") && matches!(cursor.peek(1), Some('@' | '{' | '}' | '\\'))
}
