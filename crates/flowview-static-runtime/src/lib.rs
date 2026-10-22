//! Runtime support for precompiled FlowView static templates.
//!
//! This crate contains no `.flow` parser, JavaScript parser, or compiler. It
//! validates versioned artifacts and renders their lowered static IR.

mod render;

use serde::Deserialize;
use serde_json::Value;

pub use render::{Diagnostic, Template};

/// Stable identity prefix/value stored in the JSON artifact envelope.
pub const ARTIFACT_MAGIC: &str = "FLOWVIEW-STATIC";
/// Current serialized artifact format version.
pub const FORMAT_VERSION: u16 = 1;
/// Maximum accepted artifact size, including the header.
pub const MAX_ARTIFACT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    magic: String,
    format_version: u16,
    #[serde(rename = "compiler_version")]
    _compiler_version: String,
    source: String,
    filename: String,
    nodes: Vec<Node>,
}

/// Versioned, compiler-lowered instruction tree.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[allow(dead_code)]
enum Node {
    Text {
        value: String,
        span: Span,
    },
    Interpolation {
        expression: Expr,
        raw: bool,
        span: Span,
    },
    Element {
        tag: String,
        attributes: Vec<Attribute>,
        children: Vec<Node>,
        self_closing: bool,
        span: Span,
    },
    If {
        branches: Vec<IfBranch>,
        otherwise: Vec<Node>,
        span: Span,
    },
    For {
        item: String,
        iterable: Expr,
        children: Vec<Node>,
        empty: Vec<Node>,
        span: Span,
    },
    Switch {
        expression: Expr,
        cases: Vec<SwitchCase>,
        otherwise: Vec<Node>,
        span: Span,
    },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct IfBranch {
    pub condition: Expr,
    pub children: Vec<Node>,
    pub span: Span,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SwitchCase {
    pub expression: Expr,
    pub children: Vec<Node>,
    pub span: Span,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[allow(dead_code)]
enum Attribute {
    Plain {
        name: String,
        value: Option<String>,
        quote: char,
        span: Span,
    },
    Dynamic {
        name: String,
        expression: Expr,
        span: Span,
    },
    Boolean {
        name: String,
        expression: Expr,
        span: Span,
    },
    Bound {
        name: String,
        expression: Expr,
        span: Span,
    },
    Class {
        name: String,
        expression: Expr,
        span: Span,
    },
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
struct Span {
    pub start: usize,
    pub end: usize,
}

/// Expression tree produced by the Oxc-backed compiler lowering pass.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Expr {
    Null,
    Bool {
        value: bool,
    },
    Number {
        value: serde_json::Number,
    },
    String {
        value: String,
    },
    Ident {
        name: String,
    },
    Member {
        object: Box<Expr>,
        key: Key,
    },
    Not {
        inner: Box<Expr>,
    },
    Logical {
        op: LogicalOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Key {
    Name { value: String },
    Index { value: usize },
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LogicalOp {
    And,
    Or,
    Coalesce,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum BinaryOp {
    Equality,
    Inequality,
    StrictEquality,
    StrictInequality,
    LessThan,
    LessEqualThan,
    GreaterThan,
    GreaterEqualThan,
}

/// Runtime artifact failure. Artifact bytes are untrusted input to this API.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactError {
    message: String,
}

impl std::fmt::Display for ArtifactError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ArtifactError {}

fn decode_artifact(bytes: &[u8]) -> Result<Artifact, ArtifactError> {
    if bytes.len() > MAX_ARTIFACT_BYTES {
        return Err(ArtifactError {
            message: format!("artifact exceeds the {MAX_ARTIFACT_BYTES}-byte limit"),
        });
    }
    let artifact: Artifact = serde_json::from_slice(bytes).map_err(|error| ArtifactError {
        message: format!("invalid FlowView static artifact: {error}"),
    })?;
    if artifact.magic != ARTIFACT_MAGIC {
        return Err(ArtifactError {
            message: "invalid FlowView static artifact identity".into(),
        });
    }
    if artifact.format_version != FORMAT_VERSION {
        return Err(ArtifactError {
            message: format!(
                "unsupported FlowView static artifact format version {}; runtime supports {}",
                artifact.format_version, FORMAT_VERSION
            ),
        });
    }
    Ok(artifact)
}

/// Confirm that a serialized context is an object.
pub(crate) fn valid_context(context: &Value) -> bool {
    context.is_object()
}
