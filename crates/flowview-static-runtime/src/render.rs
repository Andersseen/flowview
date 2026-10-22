use std::borrow::Cow;

use serde::Serialize;
use serde_json::Value;

use crate::{
    decode_artifact, valid_context, ArtifactError, Attribute, BinaryOp, Expr, Key, LogicalOp, Node,
    Span,
};

/// A source-located failure while rendering a precompiled template.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub message: String,
    pub code: String,
    pub filename: String,
    pub line: usize,
    pub column: usize,
    pub start: usize,
    pub end: usize,
}

/// An immutable prepared template. It can be shared across threads and renders.
#[derive(Debug)]
pub struct Template {
    source: String,
    filename: String,
    nodes: Vec<Node>,
}

impl Template {
    /// Decode and prepare a compiler-produced artifact once.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, ArtifactError> {
        let artifact = decode_artifact(bytes)?;
        Ok(Self {
            source: artifact.source,
            filename: artifact.filename,
            nodes: artifact.nodes,
        })
    }

    /// Render against an object-shaped JSON context.
    pub fn render(&self, context: &Value) -> Result<String, Vec<Diagnostic>> {
        if !valid_context(context) {
            return Err(vec![self.diagnostic(
                "Static render context must be a JSON object",
                "FV0021",
                Span { start: 0, end: 0 },
            )]);
        }
        let mut renderer = Renderer {
            template: self,
            context,
            locals: Vec::new(),
            output: String::new(),
        };
        renderer
            .nodes(&self.nodes)
            .map_err(|diagnostic| vec![diagnostic])?;
        Ok(renderer.output)
    }

    /// Serialize `context` with serde_json and render it.
    pub fn render_serializable<T: Serialize + ?Sized>(
        &self,
        context: &T,
    ) -> Result<String, Vec<Diagnostic>> {
        let value = serde_json::to_value(context).map_err(|error| {
            vec![self.diagnostic(
                &format!("Static render context could not be serialized to JSON: {error}"),
                "FV0021",
                Span { start: 0, end: 0 },
            )]
        })?;
        self.render(&value)
    }

    fn diagnostic(&self, message: &str, code: &str, span: Span) -> Diagnostic {
        let start = floor_boundary(&self.source, span.start.min(self.source.len()));
        let end = ceil_boundary(&self.source, span.end.min(self.source.len())).max(start);
        let (line, column) = position(&self.source, start);
        Diagnostic {
            message: message.to_owned(),
            code: code.to_owned(),
            filename: self.filename.clone(),
            line,
            column,
            start,
            end,
        }
    }
}

struct EvalFailure {
    message: String,
    code: &'static str,
}

#[derive(Clone)]
enum Evaluated<'a> {
    Undefined,
    Json(Cow<'a, Value>),
}

impl Evaluated<'_> {
    fn kind(&self) -> &'static str {
        match self {
            Self::Undefined => "undefined",
            Self::Json(v) => match v.as_ref() {
                Value::Null => "null",
                Value::Bool(_) => "boolean",
                Value::Number(_) => "number",
                Value::String(_) => "string",
                Value::Array(_) => "array",
                Value::Object(_) => "object",
            },
        }
    }
    fn nullish(&self) -> bool {
        matches!(self, Self::Undefined) || matches!(self, Self::Json(v) if v.is_null())
    }
    fn truthy(&self) -> bool {
        match self {
            Self::Undefined => false,
            Self::Json(v) => match v.as_ref() {
                Value::Null => false,
                Value::Bool(b) => *b,
                Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
                Value::String(s) => !s.is_empty(),
                Value::Array(_) | Value::Object(_) => true,
            },
        }
    }
}

struct Renderer<'t, 'c> {
    template: &'t Template,
    context: &'c Value,
    locals: Vec<(String, Cow<'c, Value>)>,
    output: String,
}

impl Renderer<'_, '_> {
    fn nodes(&mut self, nodes: &[Node]) -> Result<(), Diagnostic> {
        for node in nodes {
            self.node(node)?;
        }
        Ok(())
    }
    fn value(&self, expr: &Expr, span: Span) -> Result<Evaluated<'_>, Diagnostic> {
        eval(expr, &self.locals, self.context)
            .map_err(|error| self.template.diagnostic(&error.message, error.code, span))
    }
    fn node(&mut self, node: &Node) -> Result<(), Diagnostic> {
        match node {
            Node::Text { value, .. } => self.output.push_str(value),
            Node::Interpolation {
                expression,
                raw,
                span,
            } => {
                let value = self.value(expression, *span)?;
                let rendered = render_value(&value, *raw)
                    .map_err(|e| self.template.diagnostic(&e.message, e.code, *span))?;
                self.output.push_str(&rendered);
            }
            Node::Element {
                tag,
                attributes,
                children,
                self_closing,
                span,
            } => self.element(tag, attributes, children, *self_closing, *span)?,
            Node::If {
                branches,
                otherwise,
                ..
            } => {
                let mut matched = false;
                for branch in branches {
                    if self.value(&branch.condition, branch.span)?.truthy() {
                        self.nodes(&branch.children)?;
                        matched = true;
                        break;
                    }
                }
                if !matched {
                    self.nodes(otherwise)?;
                }
            }
            Node::For {
                item,
                iterable,
                children,
                empty,
                span,
            } => {
                let value = self.value(iterable, *span)?;
                let items = match value {
                    Evaluated::Undefined => None,
                    Evaluated::Json(v) if v.is_null() => None,
                    Evaluated::Json(v) => Some(v.as_array().cloned().ok_or_else(|| {
                        self.template.diagnostic(
                            &format!(
                                "`@for` needs an array in static templates, found a {} value",
                                v_kind(v.as_ref())
                            ),
                            "FV0019",
                            *span,
                        )
                    })?),
                };
                let Some(items) = items else {
                    self.nodes(empty)?;
                    return Ok(());
                };
                if items.is_empty() {
                    self.nodes(empty)?;
                } else {
                    self.locals
                        .push((item.clone(), Cow::Borrowed(&Value::Null)));
                    for value in items {
                        if let Some(last) = self.locals.last_mut() {
                            last.1 = Cow::Owned(value);
                        }
                        if let Err(error) = self.nodes(children) {
                            self.locals.pop();
                            return Err(error);
                        }
                    }
                    self.locals.pop();
                }
            }
            Node::Switch {
                expression,
                cases,
                otherwise,
                span,
            } => {
                let subject = self.value(expression, *span)?;
                let mut matched = false;
                for case in cases {
                    let candidate = self.value(&case.expression, case.span)?;
                    if strict_eq(&subject, &candidate)
                        .map_err(|e| self.template.diagnostic(&e.message, e.code, case.span))?
                    {
                        self.nodes(&case.children)?;
                        matched = true;
                        break;
                    }
                }
                if !matched {
                    self.nodes(otherwise)?;
                }
            }
        }
        Ok(())
    }

    fn element(
        &mut self,
        tag: &str,
        attrs: &[Attribute],
        children: &[Node],
        self_closing: bool,
        span: Span,
    ) -> Result<(), Diagnostic> {
        self.output.push('<');
        self.output.push_str(tag);
        let merge_class = attrs.iter().any(|a| matches!(a, Attribute::Class { .. }));
        if merge_class {
            self.merged_class(attrs)?;
        }
        for attr in attrs {
            match attr {
                Attribute::Plain {
                    name, value, quote, ..
                } => {
                    if merge_class && name == "class" {
                        continue;
                    }
                    self.output.push(' ');
                    self.output.push_str(name);
                    if let Some(value) = value {
                        self.output.push('=');
                        self.output.push(*quote);
                        self.output.push_str(value);
                        self.output.push(*quote);
                    }
                }
                Attribute::Dynamic {
                    name,
                    expression,
                    span,
                } => {
                    if merge_class && name == "class" {
                        continue;
                    }
                    let val = self.value(expression, *span)?;
                    let rendered = render_value(&val, false)
                        .map_err(|e| self.template.diagnostic(&e.message, e.code, *span))?;
                    self.output.push(' ');
                    self.output.push_str(name);
                    self.output.push_str("=\"");
                    self.output.push_str(&rendered);
                    self.output.push('"');
                }
                Attribute::Boolean {
                    name,
                    expression,
                    span,
                } => {
                    if self.value(expression, *span)?.truthy() {
                        self.output.push(' ');
                        self.output.push_str(name);
                    }
                }
                Attribute::Bound {
                    name,
                    expression,
                    span,
                } => {
                    let value = self.value(expression, *span)?;
                    if !value.nullish() {
                        let rendered = render_attribute_value(&value)
                            .map_err(|e| self.template.diagnostic(&e.message, e.code, *span))?;
                        self.output.push(' ');
                        self.output.push_str(name);
                        self.output.push_str("=\"");
                        self.output.push_str(&rendered);
                        self.output.push('"');
                    }
                }
                Attribute::Class { .. } => {}
            }
        }
        if self_closing {
            self.output.push_str("/>");
            return Ok(());
        }
        self.output.push('>');
        self.nodes(children)?;
        self.output.push_str("</");
        self.output.push_str(tag);
        self.output.push('>');
        let _ = span;
        Ok(())
    }

    fn merged_class(&mut self, attrs: &[Attribute]) -> Result<(), Diagnostic> {
        let mut classes: Vec<String> = Vec::new();
        for attr in attrs {
            match attr {
                Attribute::Plain {
                    name,
                    value: Some(value),
                    ..
                } if name == "class" => {
                    for name in value.split_whitespace() {
                        if !classes.iter().any(|c| c == name) {
                            classes.push(name.into());
                        }
                    }
                }
                Attribute::Dynamic {
                    name,
                    expression,
                    span,
                } if name == "class" => {
                    let value = self.value(expression, *span)?;
                    let rendered = render_attribute_value(&value)
                        .map_err(|e| self.template.diagnostic(&e.message, e.code, *span))?;
                    for name in rendered.split_whitespace() {
                        if !classes.iter().any(|c| c == name) {
                            classes.push(name.into());
                        }
                    }
                }
                Attribute::Class {
                    name,
                    expression,
                    span,
                } if self.value(expression, *span)?.truthy()
                    && !classes.iter().any(|c| c == name) =>
                {
                    classes.push(name.clone());
                }
                _ => {}
            }
        }
        if !classes.is_empty() {
            self.output.push_str(" class=\"");
            self.output.push_str(&escape(&classes.join(" ")));
            self.output.push('"');
        }
        Ok(())
    }
}

fn eval<'a>(
    expr: &Expr,
    locals: &[(String, Cow<'a, Value>)],
    context: &'a Value,
) -> Result<Evaluated<'a>, EvalFailure> {
    match expr {
        Expr::Null => Ok(Evaluated::Json(Cow::Owned(Value::Null))), Expr::Bool { value } => Ok(Evaluated::Json(Cow::Owned(Value::Bool(*value)))), Expr::Number { value } => Ok(Evaluated::Json(Cow::Owned(Value::Number(value.clone())))), Expr::String { value } => Ok(Evaluated::Json(Cow::Owned(Value::String(value.clone())))),
        Expr::Ident { name } => locals.iter().rev().find(|(n, _)| n == name).map(|(_, v)| Evaluated::Json(v.clone())).or_else(|| (name == "context").then_some(Evaluated::Json(Cow::Borrowed(context)))).ok_or_else(|| EvalFailure { code: "FV0017", message: format!("Unresolved identifier `{name}`: static templates can only use `context` and loop variables") }),
        Expr::Member { object, key } => { let object = eval(object, locals, context)?; let shown = match key { Key::Name { value } => value.clone(), Key::Index { value } => value.to_string() }; let json = match object { Evaluated::Undefined => return Err(EvalFailure { code: "FV0018", message: format!("Cannot read property `{shown}` of undefined") }), Evaluated::Json(v) => v };
            if let Key::Name { value } = key { if value == "length" { match json.as_ref() { Value::String(s) => return Ok(Evaluated::Json(Cow::Owned(Value::from(s.encode_utf16().count())))), Value::Array(a) => return Ok(Evaluated::Json(Cow::Owned(Value::from(a.len())))), _ => {} } } }
            let found = match (json.as_ref(), key) { (Value::Object(map), Key::Name { value }) => map.get(value), (Value::Array(items), Key::Index { value }) => items.get(*value), _ => return Err(EvalFailure { code: "FV0018", message: format!("Cannot read `{shown}` of a {} value: static templates support object keys, array indexes, and `.length` of strings and arrays", if json.is_null() { "null" } else { kind(json.as_ref()) }) }) };
            Ok(found.map_or(Evaluated::Undefined, |v| Evaluated::Json(Cow::Owned(v.clone()))))
        }
        Expr::Not { inner } => Ok(boolval(!eval(inner, locals, context)?.truthy())),
        Expr::Logical { op, left, right } => { let left = eval(left, locals, context)?; let short = match op { LogicalOp::And => !left.truthy(), LogicalOp::Or => left.truthy(), LogicalOp::Coalesce => !left.nullish() }; if short { Ok(left) } else { eval(right, locals, context) } }
        Expr::Binary { op, left, right } => { let left = eval(left, locals, context)?; let right = eval(right, locals, context)?; let value = match op { BinaryOp::StrictEquality => strict_eq(&left, &right)?, BinaryOp::StrictInequality => !strict_eq(&left, &right)?, BinaryOp::Equality => loose_eq(&left, &right)?, BinaryOp::Inequality => !loose_eq(&left, &right)?, _ => compare(*op, &left, &right)? }; Ok(boolval(value)) }
    }
}

fn boolval(value: bool) -> Evaluated<'static> {
    Evaluated::Json(Cow::Owned(Value::Bool(value)))
}
fn strict_eq(a: &Evaluated<'_>, b: &Evaluated<'_>) -> Result<bool, EvalFailure> {
    reject_composite(a, b)?;
    Ok(match (a, b) {
        (Evaluated::Undefined, Evaluated::Undefined) => true,
        (Evaluated::Json(a), Evaluated::Json(b)) => match (a.as_ref(), b.as_ref()) {
            (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
            (x, y) => x == y,
        },
        _ => false,
    })
}
fn loose_eq(a: &Evaluated<'_>, b: &Evaluated<'_>) -> Result<bool, EvalFailure> {
    reject_composite(a, b)?;
    if a.nullish() || b.nullish() {
        return Ok(a.nullish() && b.nullish());
    }
    if a.kind() == b.kind() {
        strict_eq(a, b)
    } else {
        Err(EvalFailure { code:"FV0016", message:"Loose equality between different types relies on JavaScript coercion; use `===` in static templates".into() })
    }
}
fn reject_composite(a: &Evaluated<'_>, b: &Evaluated<'_>) -> Result<(), EvalFailure> {
    if [a, b]
        .iter()
        .any(|v| matches!(v.kind(), "array" | "object"))
    {
        Err(EvalFailure { code:"FV0016", message:"Arrays and objects cannot be compared in static templates (JavaScript compares them by reference)".into() })
    } else {
        Ok(())
    }
}
fn compare(op: BinaryOp, a: &Evaluated<'_>, b: &Evaluated<'_>) -> Result<bool, EvalFailure> {
    use std::cmp::Ordering;
    let order = match (a, b) {
        (Evaluated::Json(a), Evaluated::Json(b)) => match (a.as_ref(), b.as_ref()) {
            (Value::Number(x), Value::Number(y)) => x.as_f64().partial_cmp(&y.as_f64()),
            (Value::String(x), Value::String(y)) => Some(x.cmp(y)),
            _ => None,
        },
        _ => None,
    }
    .ok_or_else(|| EvalFailure {
        code: "FV0016",
        message: format!(
            "Cannot compare {} with {}: static templates only order number/number or string/string",
            a.kind(),
            b.kind()
        ),
    })?;
    Ok(match op {
        BinaryOp::LessThan => order == Ordering::Less,
        BinaryOp::LessEqualThan => order != Ordering::Greater,
        BinaryOp::GreaterThan => order == Ordering::Greater,
        _ => order != Ordering::Less,
    })
}
fn render_value(value: &Evaluated<'_>, raw: bool) -> Result<String, EvalFailure> {
    match value {
        Evaluated::Undefined => Ok(String::new()),
        Evaluated::Json(v) => match v.as_ref() {
            Value::Null | Value::Bool(false) => Ok(String::new()),
            Value::String(s) if raw => Ok(s.clone()),
            Value::String(s) => Ok(escape(s)),
            Value::Bool(true) if raw => Err(EvalFailure { code: "FV0025", message: "Raw interpolation `{{{ }}}` requires a string, null, undefined or false, but received a value of type boolean".into() }),
            Value::Number(_) if raw => Err(EvalFailure { code: "FV0025", message: "Raw interpolation `{{{ }}}` requires a string, null, undefined or false, but received a value of type number".into() }),
            Value::Array(_) if raw => Err(EvalFailure { code: "FV0025", message: "Raw interpolation `{{{ }}}` requires a string, null, undefined or false, but received a value of type array".into() }),
            Value::Object(_) if raw => Err(EvalFailure { code: "FV0025", message: "Raw interpolation `{{{ }}}` requires a string, null, undefined or false, but received a value of type object".into() }),
            Value::Bool(b) => Ok(escape(&b.to_string())),
            Value::Number(n) => { let s = match n.as_f64() { Some(f) if f.fract()==0.0 && f.abs()<1e15 => format!("{}", f as i64), _ => n.to_string() }; Ok(escape(&s)) },
            Value::Array(_) | Value::Object(_) => Err(EvalFailure { code: "FV0020", message: format!("Cannot render {} value as an interpolation; use a string, number, or boolean", if v.is_array(){"an array"}else{"an object"}) }),
        }
    }
}
fn render_attribute_value(value: &Evaluated<'_>) -> Result<String, EvalFailure> {
    match value {
        Evaluated::Undefined => Ok(String::new()),
        Evaluated::Json(v) => match v.as_ref() {
            Value::Array(_) | Value::Object(_) => Err(EvalFailure { code: "FV0020", message: format!("Cannot render {} value as an attribute value; use a string, number, or boolean", if v.is_array(){"an array"}else{"an object"}) }),
            Value::Null => Ok(String::new()),
            Value::Bool(b) => Ok(escape(&b.to_string())),
            Value::Number(n) => { let s = match n.as_f64() { Some(f) if f.fract()==0.0 && f.abs()<1e15 => format!("{}", f as i64), _ => n.to_string() }; Ok(escape(&s)) },
            Value::String(s) => Ok(escape(s)),
        }
    }
}
fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}
fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}
fn v_kind(v: &Value) -> &'static str {
    kind(v)
}
fn floor_boundary(s: &str, mut n: usize) -> usize {
    while !s.is_char_boundary(n) {
        n -= 1;
    }
    n
}
fn ceil_boundary(s: &str, mut n: usize) -> usize {
    while !s.is_char_boundary(n) && n < s.len() {
        n += 1;
    }
    n
}
fn position(s: &str, n: usize) -> (usize, usize) {
    let mut line = 1;
    let mut col = 1;
    for ch in s[..n].chars() {
        if ch == '\n' {
            line += 1;
            col = 1
        } else {
            col += 1
        }
    }
    (line, col)
}
