//! Deterministic evaluator for the static-compatible expression subset.
//!
//! Expressions are parsed with Oxc and lowered into a small owned [`Expr`]
//! tree. Anything outside the subset is rejected during lowering. Evaluation
//! runs against a JSON context plus an explicit lexical scope; no JavaScript
//! is executed.

use oxc_allocator::Allocator;
use oxc_ast::ast::{BinaryOperator, Expression, LogicalOperator, UnaryOperator};
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde_json::Number;

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
