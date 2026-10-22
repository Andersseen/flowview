//! Static HTML backend: `template + JSON context → HTML string`.
//!
//! This backend shares the parser and AST with the JavaScript backend. It
//! evaluates only the constrained expression subset described in
//! `docs/flowview-spec.md` and never executes JavaScript.

mod evaluator;

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use crate::{
    ast::{Attribute, InterpolationMode, Node, RootNode, Span},
    diagnostics::{Diagnostic, DiagnosticCode},
    parser, validation,
};
use evaluator::{lower, EvalError, Expr, Key};
use oxc_ast::ast::{BinaryOperator, LogicalOperator};

type LoweredArtifact = (Vec<u8>, Vec<Diagnostic>, Option<String>);

/// Options for [`render_static`] (and, through [`StaticCompileOptions`],
/// [`compile_static`]).
///
/// `filename` is the display name carried by the compiled template (see
/// [`CompiledStaticTemplate::filename`]); pass the same name to
/// [`crate::DiagnosticFormatter`] when reporting diagnostics.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StaticRenderOptions {
    pub filename: Option<String>,
}

impl StaticRenderOptions {
    pub fn with_filename(mut self, filename: impl Into<String>) -> Self {
        self.filename = Some(filename.into());
        self
    }
}

/// Options for [`compile_static`]. Compile and one-off render share one type.
pub type StaticCompileOptions = StaticRenderOptions;

/// The successful result of a one-off static render.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticRenderOutput {
    pub html: String,
    pub warnings: Vec<Diagnostic>,
}

/// A deterministic serialized artifact for [`flowview_static_runtime`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticArtifactOutput {
    pub bytes: Vec<u8>,
    pub warnings: Vec<Diagnostic>,
}

/// Compile a `.flow` template into the versioned artifact consumed by
/// `flowview-static-runtime`. Compilation uses the same parser, validation and
/// Oxc-backed expression lowering as [`compile_static`].
pub fn compile_static_artifact(
    source: &str,
    options: StaticCompileOptions,
) -> Result<StaticArtifactOutput, Vec<Diagnostic>> {
    if options
        .filename
        .as_deref()
        .is_some_and(is_nonlogical_filename)
    {
        return Err(vec![Diagnostic::new(
            "AOT artifact source names must be logical relative paths",
            1,
            1,
            0,
            0,
        )]);
    }
    let (bytes, warnings, _) = lower_artifact(source, options)?;
    Ok(StaticArtifactOutput { bytes, warnings })
}

fn is_nonlogical_filename(filename: &str) -> bool {
    std::path::Path::new(filename).is_absolute()
        || filename.starts_with(['/', '\\'])
        || filename.as_bytes().get(1) == Some(&b':')
        || filename
            .split(['/', '\\'])
            .any(|component| component == "..")
}

fn lower_artifact(
    source: &str,
    options: StaticCompileOptions,
) -> Result<LoweredArtifact, Vec<Diagnostic>> {
    let root = parser::parse(source)?;
    let warnings = validation::validate(&root, source);
    let mut exprs = HashMap::new();
    let mut errors = Vec::new();
    collect_root(&root, source, &mut exprs, &mut errors);
    if !errors.is_empty() {
        return Err(errors);
    }
    let filename = options.filename;
    let artifact_filename = filename.as_deref().unwrap_or("<template>");
    let nodes = artifact_nodes(&root.children, &exprs, source);
    let artifact = serde_json::json!({
        "magic": flowview_static_runtime::ARTIFACT_MAGIC,
        "format_version": flowview_static_runtime::FORMAT_VERSION,
        "compiler_version": env!("CARGO_PKG_VERSION"),
        "source": source,
        "filename": artifact_filename,
        "nodes": nodes,
    });
    let bytes = serde_json::to_vec(&artifact).map_err(|error| {
        vec![Diagnostic::new(
            format!("Could not serialize static template artifact: {error}"),
            1,
            1,
            0,
            0,
        )]
    })?;
    if bytes.len() > flowview_static_runtime::MAX_ARTIFACT_BYTES {
        return Err(vec![Diagnostic::new(
            format!(
                "Static template artifact exceeds the {}-byte runtime limit",
                flowview_static_runtime::MAX_ARTIFACT_BYTES
            ),
            1,
            1,
            0,
            source.len(),
        )]);
    }
    Ok((bytes, warnings, filename))
}

fn artifact_span(span: Span) -> Value {
    serde_json::json!({"start": span.start, "end": span.end})
}

fn artifact_expr(expr: &Expr) -> Value {
    match expr {
        Expr::Null => serde_json::json!({"type": "null"}),
        Expr::Bool(value) => serde_json::json!({"type": "bool", "value": value}),
        Expr::Num(value) => serde_json::json!({"type": "number", "value": value}),
        Expr::Str(value) => serde_json::json!({"type": "string", "value": value}),
        Expr::Ident(name) => serde_json::json!({"type": "ident", "name": name}),
        Expr::Member(object, Key::Name(value)) => serde_json::json!({
            "type": "member", "object": artifact_expr(object), "key": {"type": "name", "value": value}
        }),
        Expr::Member(object, Key::Index(value)) => serde_json::json!({
            "type": "member", "object": artifact_expr(object), "key": {"type": "index", "value": value}
        }),
        Expr::Not(inner) => serde_json::json!({"type": "not", "inner": artifact_expr(inner)}),
        Expr::Logical(op, left, right) => serde_json::json!({
            "type": "logical",
            "op": match op { LogicalOperator::And => "and", LogicalOperator::Or => "or", LogicalOperator::Coalesce => "coalesce" },
            "left": artifact_expr(left), "right": artifact_expr(right)
        }),
        Expr::Binary(op, left, right) => serde_json::json!({
            "type": "binary",
            "op": match op {
                BinaryOperator::Equality => "equality",
                BinaryOperator::Inequality => "inequality",
                BinaryOperator::StrictEquality => "strict_equality",
                BinaryOperator::StrictInequality => "strict_inequality",
                BinaryOperator::LessThan => "less_than",
                BinaryOperator::LessEqualThan => "less_equal_than",
                BinaryOperator::GreaterThan => "greater_than",
                BinaryOperator::GreaterEqualThan => "greater_equal_than",
                _ => unreachable!("only supported operators reach artifact conversion"),
            },
            "left": artifact_expr(left), "right": artifact_expr(right)
        }),
    }
}

fn artifact_nodes(nodes: &[Node], exprs: &Exprs, source: &str) -> Vec<Value> {
    let get = |expression: &str| {
        artifact_expr(
            exprs
                .get(expression)
                .expect("expression lowered in compile pre-pass"),
        )
    };
    nodes.iter().map(|node| match node {
        Node::Text(text) => serde_json::json!({"type": "text", "value": text.value, "span": artifact_span(text.span)}),
        Node::Interpolation(i) => serde_json::json!({"type": "interpolation", "expression": get(&i.expression), "raw": i.mode == InterpolationMode::Raw, "span": artifact_span(i.span)}),
        Node::Element(element) => {
            let attributes: Vec<Value> = element.attributes.iter().map(|attribute| match attribute {
                Attribute::Plain(a) => serde_json::json!({"kind": "plain", "name": source_attribute_name(a.span, source).unwrap_or(&a.name), "value": a.value, "quote": a.quote.to_string(), "span": artifact_span(a.span)}),
                Attribute::Dynamic(a) => serde_json::json!({"kind": "dynamic", "name": a.name, "expression": get(&a.expression), "span": artifact_span(a.span)}),
                Attribute::BooleanBinding(a) => serde_json::json!({"kind": "boolean", "name": a.name, "expression": get(&a.expression), "span": artifact_span(a.span)}),
                Attribute::AttributeBinding(a) => serde_json::json!({"kind": "bound", "name": a.name, "expression": get(&a.expression), "span": artifact_span(a.span)}),
                Attribute::ClassBinding(a) => serde_json::json!({"kind": "class", "name": a.name, "expression": get(&a.expression), "span": artifact_span(a.span)}),
            }).collect();
            let tag = source_tag_name(element.span, source).unwrap_or(&element.tag);
            serde_json::json!({"type": "element", "tag": tag, "attributes": attributes, "children": artifact_nodes(&element.children, exprs, source), "self_closing": element.self_closing, "span": artifact_span(element.span)})
        }
        Node::IfBlock(block) => {
            let branches: Vec<Value> = block.branches.iter().map(|branch| serde_json::json!({"condition": get(&branch.condition), "children": artifact_nodes(&branch.children, exprs, source), "span": artifact_span(branch.span)})).collect();
            let otherwise = block.else_branch.as_ref().map_or_else(Vec::new, |items| artifact_nodes(items, exprs, source));
            serde_json::json!({"type": "if", "branches": branches, "otherwise": otherwise, "span": artifact_span(block.span)})
        }
        Node::ForBlock(block) => {
            let empty = block.empty.as_ref().map_or_else(Vec::new, |items| artifact_nodes(items, exprs, source));
            serde_json::json!({"type": "for", "item": block.item, "iterable": get(&block.iterable), "children": artifact_nodes(&block.children, exprs, source), "empty": empty, "span": artifact_span(block.span)})
        }
        Node::SwitchBlock(block) => {
            let cases: Vec<Value> = block.cases.iter().map(|case| serde_json::json!({"expression": get(&case.expression), "children": artifact_nodes(&case.children, exprs, source), "span": artifact_span(case.span)})).collect();
            let otherwise = block.default.as_ref().map_or_else(Vec::new, |items| artifact_nodes(items, exprs, source));
            serde_json::json!({"type": "switch", "expression": get(&block.expression), "cases": cases, "otherwise": otherwise, "span": artifact_span(block.span)})
        }
    }).collect()
}

/// A template that has been parsed, validated and expression-lowered once.
///
/// It owns the compiler-free prepared runtime representation and compile-time
/// warnings, so the original source string may be dropped. It is immutable:
/// [`render`](Self::render) borrows it and keeps per-render state local, so one
/// compiled template can render any number of contexts, from any thread.
#[derive(Debug)]
pub struct CompiledStaticTemplate {
    runtime: flowview_static_runtime::Template,
    warnings: Vec<Diagnostic>,
    filename: Option<String>,
}

/// Parse, validate and lower `source` once for repeated static rendering.
///
/// Every failure that does not depend on a context (syntax errors, invalid or
/// unsupported static expressions, even in branches no context would reach)
/// is reported here.
pub fn compile_static(
    source: &str,
    options: StaticCompileOptions,
) -> Result<CompiledStaticTemplate, Vec<Diagnostic>> {
    CompiledStaticTemplate::compile(source, options)
}

impl CompiledStaticTemplate {
    /// Same as [`compile_static`].
    pub fn compile(source: &str, options: StaticCompileOptions) -> Result<Self, Vec<Diagnostic>> {
        let (artifact, warnings, filename) = lower_artifact(source, options)?;
        let runtime =
            flowview_static_runtime::Template::from_bytes(&artifact).map_err(|error| {
                vec![Diagnostic::new(
                    format!("Could not prepare static template: {error}"),
                    1,
                    1,
                    0,
                    source.len(),
                )]
            })?;
        Ok(Self {
            runtime,
            warnings,
            filename,
        })
    }

    /// Compile-time warnings (for example the `@for` `track` warning). They
    /// are produced once by compilation and never change between renders.
    pub fn warnings(&self) -> &[Diagnostic] {
        &self.warnings
    }

    /// The filename supplied at compile time, if any.
    pub fn filename(&self) -> Option<&str> {
        self.filename.as_deref()
    }

    /// Render against a JSON object context (visible to the template as
    /// `context`). Only context-dependent failures can occur here.
    pub fn render(&self, context: &Value) -> Result<String, Vec<Diagnostic>> {
        self.runtime.render(context).map_err(|errors| {
            errors
                .into_iter()
                .map(|error| {
                    Diagnostic::new(
                        error.message,
                        error.line,
                        error.column,
                        error.start,
                        error.end,
                    )
                    .with_code(error.code)
                })
                .collect()
        })
    }

    /// Serialize `context` with `serde_json` and render the result.
    ///
    /// This is an ergonomic convenience for typed page models, equivalent to
    /// `render(&serde_json::to_value(context)?)`. It is **not** a performance
    /// optimization: the model is still materialized as a [`Value`] on every
    /// call. A value that fails to serialize, or that does not serialize to a
    /// JSON object, yields an `FV0021` (invalid static context) diagnostic.
    pub fn render_serializable<T: Serialize + ?Sized>(
        &self,
        context: &T,
    ) -> Result<String, Vec<Diagnostic>> {
        self.runtime.render_serializable(context).map_err(|errors| {
            errors
                .into_iter()
                .map(|error| {
                    Diagnostic::new(
                        error.message,
                        error.line,
                        error.column,
                        error.start,
                        error.end,
                    )
                    .with_code(error.code)
                })
                .collect()
        })
    }
}

fn check_context(context: &Value) -> Result<(), Vec<Diagnostic>> {
    if context.is_object() {
        return Ok(());
    }
    Err(vec![Diagnostic::new(
        "Static render context must be a JSON object",
        1,
        1,
        0,
        0,
    )
    .with_diagnostic_code(DiagnosticCode::StaticInvalidContext)])
}

/// Render a flowview template against a JSON context into final HTML.
///
/// One-off convenience over [`compile_static`] + [`CompiledStaticTemplate::render`];
/// prefer those when rendering the same template more than once. The context
/// must be a JSON object; templates see it as `context`. Compile-time warnings
/// are returned in the output.
pub fn render_static(
    source: &str,
    context: &Value,
    options: StaticRenderOptions,
) -> Result<StaticRenderOutput, Vec<Diagnostic>> {
    check_context(context)?;
    let template = compile_static(source, options)?;
    let html = template.render(context)?;
    Ok(StaticRenderOutput {
        html,
        warnings: template.warnings,
    })
}

// ---------------------------------------------------------------------------
// Pre-pass: lower every expression so unsupported ones are reported up front,
// independent of the data and of which branches run.
// ---------------------------------------------------------------------------

type Exprs = HashMap<String, Expr>;

fn collect_expr(
    expression: &str,
    span: Span,
    source: &str,
    exprs: &mut Exprs,
    errors: &mut Vec<Diagnostic>,
) {
    if exprs.contains_key(expression) {
        return;
    }
    match lower(expression) {
        Ok(expr) => {
            exprs.insert(expression.to_owned(), expr);
        }
        Err(error) => errors.push(to_diagnostic(error, source, span)),
    }
}

fn collect_root(root: &RootNode, source: &str, exprs: &mut Exprs, errors: &mut Vec<Diagnostic>) {
    collect_nodes(&root.children, source, exprs, errors);
}

fn collect_nodes(nodes: &[Node], source: &str, exprs: &mut Exprs, errors: &mut Vec<Diagnostic>) {
    for node in nodes {
        match node {
            Node::Text(_) => {}
            Node::Interpolation(i) => collect_expr(&i.expression, i.span, source, exprs, errors),
            Node::Element(element) => {
                for attribute in &element.attributes {
                    match attribute {
                        Attribute::Plain(_) => {}
                        Attribute::Dynamic(a) => {
                            collect_expr(&a.expression, a.span, source, exprs, errors)
                        }
                        Attribute::BooleanBinding(a) => {
                            collect_expr(&a.expression, a.span, source, exprs, errors)
                        }
                        Attribute::AttributeBinding(a) => {
                            collect_expr(&a.expression, a.span, source, exprs, errors)
                        }
                        Attribute::ClassBinding(a) => {
                            collect_expr(&a.expression, a.span, source, exprs, errors)
                        }
                    }
                }
                collect_nodes(&element.children, source, exprs, errors);
            }
            Node::IfBlock(block) => {
                for branch in &block.branches {
                    collect_expr(&branch.condition, branch.span, source, exprs, errors);
                    collect_nodes(&branch.children, source, exprs, errors);
                }
                if let Some(children) = &block.else_branch {
                    collect_nodes(children, source, exprs, errors);
                }
            }
            Node::ForBlock(block) => {
                collect_expr(&block.iterable, block.span, source, exprs, errors);
                collect_nodes(&block.children, source, exprs, errors);
                if let Some(children) = &block.empty {
                    collect_nodes(children, source, exprs, errors);
                }
            }
            Node::SwitchBlock(block) => {
                collect_expr(&block.expression, block.span, source, exprs, errors);
                for case in &block.cases {
                    collect_expr(&case.expression, case.span, source, exprs, errors);
                    collect_nodes(&case.children, source, exprs, errors);
                }
                if let Some(children) = &block.default {
                    collect_nodes(children, source, exprs, errors);
                }
            }
        }
    }
}

fn to_diagnostic(error: EvalError, source: &str, span: Span) -> Diagnostic {
    Diagnostic::from_source(error.message, source, span.start, span.end)
        .with_diagnostic_code(error.code)
}

fn source_tag_name(span: Span, source: &str) -> Option<&str> {
    let rest = source.get(span.start.checked_add(1)?..)?;
    let end = rest.find(|ch: char| ch.is_ascii_whitespace() || ch == '/' || ch == '>')?;
    Some(&rest[..end])
}

fn source_attribute_name(span: Span, source: &str) -> Option<&str> {
    let rest = source.get(span.start..span.end)?;
    let end = rest.find(|ch: char| ch.is_ascii_whitespace() || ch == '=')?;
    Some(&rest[..end])
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod compiled_tests;
