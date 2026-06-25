/// A lightweight cursor over a source string.
///
/// The cursor tracks byte offsets and line/column positions so that diagnostics
/// can point back to the exact location in the original template.
#[derive(Debug, Clone)]
pub struct Cursor<'a> {
    source: &'a str,
    position: usize,
    line: usize,
    column: usize,
}

impl<'a> Cursor<'a> {
    pub fn new(source: &'a str) -> Self {
        Self {
            source,
            position: 0,
            line: 1,
            column: 1,
        }
    }

    pub fn source(&self) -> &'a str {
        self.source
    }

    pub fn position(&self) -> usize {
        self.position
    }

    pub fn line(&self) -> usize {
        self.line
    }

    pub fn column(&self) -> usize {
        self.column
    }

    pub fn is_eof(&self) -> bool {
        self.position >= self.source.len()
    }

    pub fn current(&self) -> Option<char> {
        self.source[self.position..].chars().next()
    }

    pub fn peek(&self, offset: usize) -> Option<char> {
        self.source[self.position..].chars().nth(offset)
    }

    pub fn starts_with(&self, prefix: &str) -> bool {
        self.source[self.position..].starts_with(prefix)
    }

    pub fn starts_with_ignore_ascii_case(&self, prefix: &str) -> bool {
        self.source[self.position..]
            .get(..prefix.len())
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(prefix))
    }

    pub fn advance(&mut self) -> Option<char> {
        let ch = self.current()?;
        let len = ch.len_utf8();
        self.position += len;

        if ch == '\n' {
            self.line += 1;
            self.column = 1;
        } else {
            self.column += 1;
        }

        Some(ch)
    }

    pub fn advance_by(&mut self, count: usize) {
        for _ in 0..count {
            if self.advance().is_none() {
                break;
            }
        }
    }

    pub fn slice(&self, start: usize, end: usize) -> &'a str {
        &self.source[start..end]
    }

    pub fn span_text(&self, start: usize, end: usize) -> &'a str {
        self.slice(start, end)
    }

    /// Capture a snapshot of the current position for precise diagnostics.
    pub fn snapshot(&self) -> CursorPosition {
        CursorPosition {
            position: self.position,
            line: self.line,
            column: self.column,
        }
    }

    /// Skip ASCII and Unicode whitespace without consuming anything else.
    pub fn skip_whitespace(&mut self) {
        while let Some(ch) = self.current() {
            if ch.is_whitespace() {
                self.advance();
            } else {
                break;
            }
        }
    }
}

/// Immutable snapshot of a cursor position, typically captured at the start of a
/// token so diagnostics can report the exact offending location.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CursorPosition {
    pub position: usize,
    pub line: usize,
    pub column: usize,
}
