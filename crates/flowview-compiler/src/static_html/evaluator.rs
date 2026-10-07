//! Deterministic evaluator for the static-compatible expression subset.
//!
//! Expressions are parsed with Oxc and lowered into a small owned [`Expr`]
//! tree. Anything outside the subset is rejected during lowering. Evaluation
//! runs against a JSON context plus an explicit lexical scope; no JavaScript
//! is executed.

use std::borrow::Cow;

use oxc_allocator::Allocator;
use oxc_ast::ast::{BinaryOperator, Expression, LogicalOperator, UnaryOperator};
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde_json::{Number, Value};

use crate::diagnostics::DiagnosticCode;

/// Property or index key with a statically known value.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Key {
    Name(String),
    Index(usize),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Expr {
    Null,
    Bool(bool),
    Num(Number),
    Str(String),
    Ident(String),
    Member(Box<Expr>, Key),
    Not(Box<Expr>),
    Logical(LogicalOperator, Box<Expr>, Box<Expr>),
    Binary(BinaryOperator, Box<Expr>, Box<Expr>),
}

/// An evaluation failure, converted into a diagnostic by the renderer.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EvalError {
    pub code: DiagnosticCode,
    pub message: String,
}

impl EvalError {
    fn new(code: DiagnosticCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn unsupported(message: impl Into<String>) -> Self {
        Self::new(DiagnosticCode::StaticUnsupportedExpression, message)
    }
}

/// Parse and lower an expression. The error is a human-readable reason.
pub(crate) fn lower(expression: &str) -> Result<Expr, EvalError> {
    let allocator = Allocator::new();
    let parsed = Parser::new(&allocator, expression, SourceType::default()).parse_expression();
    match parsed {
        Ok(expr) => lower_expr(&expr).map_err(|reason| {
            EvalError::unsupported(format!(
                "Expression `{}` is valid JavaScript but is not supported by the static HTML target: {}",
                expression, reason
            ))
        }),
        Err(errors) => Err(EvalError::new(
            DiagnosticCode::InvalidJavaScriptExpression,
            format!(
                "Invalid JavaScript expression: {}",
                errors
                    .first()
                    .map_or_else(|| "parse error".to_string(), |e| e.message.to_string())
            ),
        )),
    }
}

fn lower_expr(expr: &Expression) -> Result<Expr, String> {
    match expr {
        Expression::BooleanLiteral(b) => Ok(Expr::Bool(b.value)),
        Expression::NullLiteral(_) => Ok(Expr::Null),
        Expression::NumericLiteral(n) => number(n.value),
        Expression::StringLiteral(s) => Ok(Expr::Str(s.value.as_str().to_owned())),
        Expression::Identifier(i) => Ok(Expr::Ident(i.name.as_str().to_owned())),
        Expression::ParenthesizedExpression(p) => lower_expr(&p.expression),
        Expression::StaticMemberExpression(m) => {
            if m.optional {
                return Err("optional chaining".into());
            }
            Ok(Expr::Member(
                Box::new(lower_expr(&m.object)?),
                Key::Name(m.property.name.as_str().to_owned()),
            ))
        }
        Expression::ComputedMemberExpression(m) => {
            if m.optional {
                return Err("optional chaining".into());
            }
            let key = match &m.expression {
                Expression::StringLiteral(s) => Key::Name(s.value.as_str().to_owned()),
                Expression::NumericLiteral(n)
                    if n.value >= 0.0 && n.value.fract() == 0.0 && n.value < 4_294_967_296.0 =>
                {
                    Key::Index(n.value as usize)
                }
                _ => return Err("computed member access requires a string literal or non-negative integer literal".into()),
            };
            Ok(Expr::Member(Box::new(lower_expr(&m.object)?), key))
        }
        Expression::UnaryExpression(u) => match (u.operator, &u.argument) {
            (UnaryOperator::LogicalNot, arg) => Ok(Expr::Not(Box::new(lower_expr(arg)?))),
            (UnaryOperator::UnaryNegation, Expression::NumericLiteral(n)) => number(-n.value),
            _ => Err(format!("unary operator `{}`", u.operator.as_str())),
        },
        Expression::LogicalExpression(l) => Ok(Expr::Logical(
            l.operator,
            Box::new(lower_expr(&l.left)?),
            Box::new(lower_expr(&l.right)?),
        )),
        Expression::BinaryExpression(b) => match b.operator {
            BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
            | BinaryOperator::LessThan
            | BinaryOperator::LessEqualThan
            | BinaryOperator::GreaterThan
            | BinaryOperator::GreaterEqualThan => Ok(Expr::Binary(
                b.operator,
                Box::new(lower_expr(&b.left)?),
                Box::new(lower_expr(&b.right)?),
            )),
            other => Err(format!("binary operator `{}`", other.as_str())),
        },
        Expression::CallExpression(_) | Expression::NewExpression(_) => {
            Err("function calls".into())
        }
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            Err("functions".into())
        }
        Expression::ChainExpression(_) => Err("optional chaining".into()),
        Expression::TemplateLiteral(_) | Expression::TaggedTemplateExpression(_) => {
            Err("template literals".into())
        }
        Expression::ConditionalExpression(_) => Err("conditional (ternary) expressions".into()),
        Expression::ArrayExpression(_) | Expression::ObjectExpression(_) => {
            Err("array and object literals".into())
        }
        Expression::AssignmentExpression(_) | Expression::UpdateExpression(_) => {
            Err("assignments".into())
        }
        _ => Err("this expression form".into()),
    }
}

fn number(value: f64) -> Result<Expr, String> {
    Number::from_f64(value)
        .map(Expr::Num)
        .ok_or_else(|| "non-finite numeric literal".to_string())
}

/// A static value: JSON plus JavaScript's `undefined` (missing property).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Val<'a> {
    Undefined,
    Json(Cow<'a, Value>),
}

impl<'a> Val<'a> {
    fn bool(value: bool) -> Self {
        Val::Json(Cow::Owned(Value::Bool(value)))
    }

    fn kind(&self) -> &'static str {
        match self {
            Val::Undefined => "undefined",
            Val::Json(v) => match v.as_ref() {
                Value::Null => "null",
                Value::Bool(_) => "boolean",
                Value::Number(_) => "number",
                Value::String(_) => "string",
                Value::Array(_) => "array",
                Value::Object(_) => "object",
            },
        }
    }

    pub(crate) fn is_nullish(&self) -> bool {
        match self {
            Val::Undefined => true,
            Val::Json(v) => v.is_null(),
        }
    }

    /// JavaScript truthiness.
    pub(crate) fn truthy(&self) -> bool {
        match self {
            Val::Undefined => false,
            Val::Json(v) => match v.as_ref() {
                Value::Null => false,
                Value::Bool(b) => *b,
                Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
                Value::String(s) => !s.is_empty(),
                Value::Array(_) | Value::Object(_) => true,
            },
        }
    }
}

/// Lexical environment: the immutable context plus loop-local bindings.
pub(crate) struct Scope<'a> {
    context: &'a Value,
    locals: Vec<(String, Cow<'a, Value>)>,
}

impl<'a> Scope<'a> {
    pub(crate) fn new(context: &'a Value) -> Self {
        Self {
            context,
            locals: Vec::new(),
        }
    }

    pub(crate) fn push(&mut self, name: &str, value: Cow<'a, Value>) {
        self.locals.push((name.to_owned(), value));
    }

    pub(crate) fn set_last(&mut self, value: Cow<'a, Value>) {
        if let Some(last) = self.locals.last_mut() {
            last.1 = value;
        }
    }

    pub(crate) fn pop(&mut self) {
        self.locals.pop();
    }

    fn lookup(&self, name: &str) -> Option<Val<'a>> {
        if let Some((_, value)) = self.locals.iter().rev().find(|(n, _)| n == name) {
            return Some(Val::Json(value.clone()));
        }
        (name == "context").then_some(Val::Json(Cow::Borrowed(self.context)))
    }
}

pub(crate) fn eval<'a>(expr: &Expr, scope: &Scope<'a>) -> Result<Val<'a>, EvalError> {
    match expr {
        Expr::Null => Ok(Val::Json(Cow::Owned(Value::Null))),
        Expr::Bool(b) => Ok(Val::bool(*b)),
        Expr::Num(n) => Ok(Val::Json(Cow::Owned(Value::Number(n.clone())))),
        Expr::Str(s) => Ok(Val::Json(Cow::Owned(Value::String(s.clone())))),
        Expr::Ident(name) => scope.lookup(name).ok_or_else(|| {
            EvalError::new(
                DiagnosticCode::StaticUnresolvedIdentifier,
                format!(
                    "Unresolved identifier `{}`: static templates can only use `context` and loop variables",
                    name
                ),
            )
        }),
        Expr::Member(object, key) => member(eval(object, scope)?, key),
        Expr::Not(inner) => Ok(Val::bool(!eval(inner, scope)?.truthy())),
        Expr::Logical(op, left, right) => {
            let left = eval(left, scope)?;
            let short_circuit = match op {
                LogicalOperator::And => !left.truthy(),
                LogicalOperator::Or => left.truthy(),
                LogicalOperator::Coalesce => !left.is_nullish(),
            };
            if short_circuit {
                Ok(left)
            } else {
                eval(right, scope)
            }
        }
        Expr::Binary(op, left, right) => {
            let left = eval(left, scope)?;
            let right = eval(right, scope)?;
            binary(*op, &left, &right)
        }
    }
}

fn member<'a>(object: Val<'a>, key: &Key) -> Result<Val<'a>, EvalError> {
    let shown = match key {
        Key::Name(n) => n.clone(),
        Key::Index(i) => i.to_string(),
    };
    let json = match object {
        Val::Undefined => return Err(read_error(&shown, "undefined")),
        Val::Json(json) => json,
    };

    // `.length` of strings and arrays.
    if let Key::Name(name) = key {
        if name == "length" {
            match json.as_ref() {
                Value::String(s) => {
                    return Ok(Val::Json(Cow::Owned(Value::from(s.encode_utf16().count()))))
                }
                Value::Array(a) => return Ok(Val::Json(Cow::Owned(Value::from(a.len())))),
                _ => {}
            }
        }
    }

    let kind = Val::Json(json.clone()).kind();
    let missing_ok = |found: Option<Cow<'a, Value>>| Ok(found.map_or(Val::Undefined, Val::Json));
    match (json, key) {
        (Cow::Borrowed(Value::Object(map)), Key::Name(n)) => {
            missing_ok(map.get(n).map(Cow::Borrowed))
        }
        (Cow::Owned(Value::Object(map)), Key::Name(n)) => {
            missing_ok(map.get(n).cloned().map(Cow::Owned))
        }
        (Cow::Borrowed(Value::Array(items)), Key::Index(i)) => {
            missing_ok(items.get(*i).map(Cow::Borrowed))
        }
        (Cow::Owned(Value::Array(items)), Key::Index(i)) => {
            missing_ok(items.get(*i).cloned().map(Cow::Owned))
        }
        _ => Err(match kind {
            "null" => read_error(&shown, "null"),
            _ => EvalError::new(
                DiagnosticCode::StaticInvalidMemberAccess,
                format!(
                    "Cannot read `{}` of a {} value: static templates support object keys, array indexes, and `.length` of strings and arrays",
                    shown, kind
                ),
            ),
        }),
    }
}

fn read_error(property: &str, of: &str) -> EvalError {
    EvalError::new(
        DiagnosticCode::StaticInvalidMemberAccess,
        format!("Cannot read property `{}` of {}", property, of),
    )
}

fn binary<'a>(op: BinaryOperator, left: &Val<'a>, right: &Val<'a>) -> Result<Val<'a>, EvalError> {
    let result = match op {
        BinaryOperator::StrictEquality => strict_equals(left, right)?,
        BinaryOperator::StrictInequality => !strict_equals(left, right)?,
        BinaryOperator::Equality => loose_eq(left, right)?,
        BinaryOperator::Inequality => !loose_eq(left, right)?,
        _ => compare(op, left, right)?,
    };
    Ok(Val::bool(result))
}

fn reject_composite(left: &Val, right: &Val) -> Result<(), EvalError> {
    for side in [left, right] {
        if matches!(side.kind(), "array" | "object") {
            return Err(EvalError::unsupported(
                "Arrays and objects cannot be compared in static templates (JavaScript compares them by reference)",
            ));
        }
    }
    Ok(())
}

pub(crate) fn strict_equals(left: &Val, right: &Val) -> Result<bool, EvalError> {
    reject_composite(left, right)?;
    Ok(match (left, right) {
        (Val::Undefined, Val::Undefined) => true,
        (Val::Json(a), Val::Json(b)) => match (a.as_ref(), b.as_ref()) {
            (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
            (x, y) => x == y,
        },
        _ => false,
    })
}

fn loose_eq(left: &Val, right: &Val) -> Result<bool, EvalError> {
    reject_composite(left, right)?;
    match (left.is_nullish(), right.is_nullish()) {
        (true, true) => Ok(true),
        (true, false) | (false, true) => Ok(false),
        _ if left.kind() == right.kind() => strict_equals(left, right),
        _ => Err(EvalError::unsupported(
            "Loose equality between different types relies on JavaScript coercion; use `===` in static templates",
        )),
    }
}

fn compare(op: BinaryOperator, left: &Val, right: &Val) -> Result<bool, EvalError> {
    use std::cmp::Ordering;
    let ordering = match (left, right) {
        (Val::Json(a), Val::Json(b)) => match (a.as_ref(), b.as_ref()) {
            (Value::Number(x), Value::Number(y)) => x.as_f64().partial_cmp(&y.as_f64()),
            (Value::String(x), Value::String(y)) => Some(x.cmp(y)),
            _ => None,
        },
        _ => None,
    };
    let Some(ordering) = ordering else {
        return Err(EvalError::unsupported(format!(
            "Cannot compare {} with {}: static templates only order number/number or string/string",
            left.kind(),
            right.kind()
        )));
    };
    Ok(match op {
        BinaryOperator::LessThan => ordering == Ordering::Less,
        BinaryOperator::LessEqualThan => ordering != Ordering::Greater,
        BinaryOperator::GreaterThan => ordering == Ordering::Greater,
        _ => ordering != Ordering::Less,
    })
}

/// Escape text exactly like `escapeHtml` in `@flowview/runtime`.
pub(crate) fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
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

fn stringify(value: &Value, what: &str) -> Result<String, EvalError> {
    match value {
        Value::Null => Ok(String::new()),
        Value::Bool(b) => Ok(b.to_string()),
        Value::Number(n) => Ok(match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", f as i64),
            _ => n.to_string(),
        }),
        Value::String(s) => Ok(s.clone()),
        Value::Array(_) | Value::Object(_) => Err(EvalError::new(
            DiagnosticCode::StaticUnsupportedValue,
            format!(
                "Cannot render {} value {} in static output; use a string, number, or boolean",
                if value.is_array() {
                    "an array"
                } else {
                    "an object"
                },
                what
            ),
        )),
    }
}

/// Static equivalent of `renderValue`: `null`, `undefined` and `false` render
/// as an empty string; the result is HTML-escaped.
pub(crate) fn render_value(value: &Val) -> Result<String, EvalError> {
    match value {
        Val::Undefined => Ok(String::new()),
        Val::Json(v) => match v.as_ref() {
            Value::Null | Value::Bool(false) => Ok(String::new()),
            other => Ok(escape_html(&stringify(other, "as an interpolation")?)),
        },
    }
}

/// Static equivalent of `renderRawValue`: only strings are inserted, verbatim.
/// `null`, `undefined` and `false` render as an empty string; every other value
/// is rejected so the two targets cannot disagree about what "raw" means.
pub(crate) fn render_raw_value(value: &Val) -> Result<String, EvalError> {
    let kind = match value {
        Val::Undefined => return Ok(String::new()),
        Val::Json(v) => match v.as_ref() {
            Value::String(text) => return Ok(text.clone()),
            Value::Null | Value::Bool(false) => return Ok(String::new()),
            Value::Bool(true) => "boolean",
            Value::Number(_) => "number",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        },
    };
    Err(EvalError::new(
        DiagnosticCode::StaticInvalidRawValue,
        format!(
            "Raw interpolation `{{{{{{ }}}}}}` requires a string, null, undefined or false, but received a value of type {kind}"
        ),
    ))
}

/// Static equivalent of `renderAttributeValue`: `null`/`undefined` become an
/// empty string, everything else is stringified (so `false` is `"false"`).
pub(crate) fn render_attribute_value(value: &Val) -> Result<String, EvalError> {
    match value {
        Val::Undefined => Ok(String::new()),
        Val::Json(v) => Ok(escape_html(&stringify(v, "as an attribute value")?)),
    }
}
