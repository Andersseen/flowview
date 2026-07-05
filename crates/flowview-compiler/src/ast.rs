use serde::Serialize;

/// Byte range inside the source template.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

/// The root of a parsed template.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RootNode {
    pub children: Vec<Node>,
}

/// Any node that can appear as a child of the root or inside a block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type")]
pub enum Node {
    Text(TextNode),
    Interpolation(InterpolationNode),
    Element(ElementNode),
    IfBlock(IfBlockNode),
    ForBlock(ForBlockNode),
    SwitchBlock(SwitchBlockNode),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TextNode {
    pub value: String,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InterpolationNode {
    pub expression: String,
    pub span: Span,
}

/// An HTML-like element.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ElementNode {
    pub tag: String,
    pub attributes: Vec<Attribute>,
    pub children: Vec<Node>,
    pub self_closing: bool,
    pub span: Span,
}

/// An element attribute. Plain attributes are static strings; dynamic
/// attributes contain a JavaScript expression that will be evaluated at
/// runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind")]
pub enum Attribute {
    Plain(PlainAttribute),
    Dynamic(DynamicAttribute),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlainAttribute {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub quote: char,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DynamicAttribute {
    pub name: String,
    pub expression: String,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IfBlockNode {
    pub branches: Vec<IfBranch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub else_branch: Option<Vec<Node>>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IfBranch {
    pub condition: String,
    pub children: Vec<Node>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ForBlockNode {
    pub item: String,
    pub iterable: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<String>,
    pub children: Vec<Node>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty: Option<Vec<Node>>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SwitchBlockNode {
    pub expression: String,
    pub cases: Vec<SwitchCaseNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<Vec<Node>>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SwitchCaseNode {
    pub expression: String,
    pub children: Vec<Node>,
    pub span: Span,
}
