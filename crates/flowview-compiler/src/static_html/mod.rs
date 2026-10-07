//! Static HTML backend: `template + JSON context → HTML string`.
//!
//! This backend shares the parser and AST with the JavaScript backend. It
//! evaluates only the constrained expression subset described in
//! `docs/flowview-spec.md` and never executes JavaScript.

mod evaluator;

use std::{borrow::Cow, collections::HashMap};

use serde_json::Value;

use crate::{
    ast::{Attribute, ElementNode, Node, RootNode, Span},
    diagnostics::{Diagnostic, DiagnosticCode},
    parser, validation,
};
use evaluator::{eval, lower, render_attribute_value, render_value, EvalError, Expr, Scope, Val};

/// Options for [`render_static`].
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

/// The successful result of a static render.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticRenderOutput {
    pub html: String,
    pub warnings: Vec<Diagnostic>,
}

/// Render a flowview template against a JSON context into final HTML.
///
/// The context must be a JSON object; templates see it as `context`.
pub fn render_static(
    source: &str,
    context: &Value,
    _options: StaticRenderOptions,
) -> Result<StaticRenderOutput, Vec<Diagnostic>> {
    if !context.is_object() {
        return Err(vec![Diagnostic::new(
            "Static render context must be a JSON object",
            1,
            1,
            0,
            0,
        )
        .with_diagnostic_code(DiagnosticCode::StaticInvalidContext)]);
    }

    let root = parser::parse(source)?;
    let warnings = validation::validate(&root, source);

    let mut exprs = HashMap::new();
    let mut errors = Vec::new();
    collect_root(&root, source, &mut exprs, &mut errors);
    if !errors.is_empty() {
        return Err(errors);
    }

    let mut renderer = Renderer {
        source,
        exprs,
        scope: Scope::new(context),
        out: String::new(),
    };
    renderer
        .nodes(&root.children)
        .map_err(|diagnostic| vec![diagnostic])?;
    Ok(StaticRenderOutput {
        html: renderer.out,
        warnings,
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

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

struct Renderer<'s, 'a> {
    source: &'s str,
    exprs: Exprs,
    scope: Scope<'a>,
    out: String,
}

type RenderResult = Result<(), Diagnostic>;

impl<'a> Renderer<'_, 'a> {
    fn value(&self, expression: &str, span: Span) -> Result<Val<'a>, Diagnostic> {
        let expr = self
            .exprs
            .get(expression)
            .expect("expression lowered in pre-pass");
        eval(expr, &self.scope).map_err(|e| to_diagnostic(e, self.source, span))
    }

    fn fail<T>(&self, result: Result<T, EvalError>, span: Span) -> Result<T, Diagnostic> {
        result.map_err(|e| to_diagnostic(e, self.source, span))
    }

    fn nodes(&mut self, nodes: &[Node]) -> RenderResult {
        nodes.iter().try_for_each(|node| self.node(node))
    }

    fn node(&mut self, node: &Node) -> RenderResult {
        match node {
            Node::Text(text) => self.out.push_str(&text.value),
            Node::Interpolation(i) => {
                let value = self.value(&i.expression, i.span)?;
                let rendered = self.fail(render_value(&value), i.span)?;
                self.out.push_str(&rendered);
            }
            Node::Element(element) => self.element(element)?,
            Node::IfBlock(block) => {
                for branch in &block.branches {
                    if self.value(&branch.condition, branch.span)?.truthy() {
                        return self.nodes(&branch.children);
                    }
                }
                if let Some(children) = &block.else_branch {
                    self.nodes(children)?;
                }
            }
            Node::ForBlock(block) => {
                let iterable = self.value(&block.iterable, block.span)?;
                let items: Vec<Cow<'a, Value>> = match iterable {
                    Val::Json(json) => match json {
                        Cow::Borrowed(Value::Array(items)) => {
                            items.iter().map(Cow::Borrowed).collect()
                        }
                        Cow::Owned(Value::Array(items)) => {
                            items.into_iter().map(Cow::Owned).collect()
                        }
                        other if other.is_null() => Vec::new(),
                        other => {
                            return Err(invalid_iterable(self.source, block.span, &other));
                        }
                    },
                    Val::Undefined => Vec::new(),
                };

                if items.is_empty() {
                    if let Some(empty) = &block.empty {
                        self.nodes(empty)?;
                    }
                } else {
                    self.scope.push(&block.item, Cow::Owned(Value::Null));
                    for item in items {
                        self.scope.set_last(item);
                        if let Err(error) = self.nodes(&block.children) {
                            self.scope.pop();
                            return Err(error);
                        }
                    }
                    self.scope.pop();
                }
            }
            Node::SwitchBlock(block) => {
                let subject = self.value(&block.expression, block.span)?;
                for case in &block.cases {
                    let candidate = self.value(&case.expression, case.span)?;
                    let matched = self.fail(strict_equal(&subject, &candidate), case.span)?;
                    if matched {
                        return self.nodes(&case.children);
                    }
                }
                if let Some(children) = &block.default {
                    self.nodes(children)?;
                }
            }
        }
        Ok(())
    }

    fn element(&mut self, element: &ElementNode) -> RenderResult {
        self.out.push('<');
        self.out.push_str(&element.tag);

        let has_class_bindings = element
            .attributes
            .iter()
            .any(|attr| matches!(attr, Attribute::ClassBinding(_)));

        if has_class_bindings {
            self.merged_class(element)?;
        }

        for attribute in &element.attributes {
            match attribute {
                Attribute::Plain(plain) => {
                    if has_class_bindings && plain.name == "class" {
                        continue;
                    }
                    self.out.push(' ');
                    self.out.push_str(&plain.name);
                    if let Some(value) = &plain.value {
                        self.out.push('=');
                        self.out.push(plain.quote);
                        self.out.push_str(value);
                        self.out.push(plain.quote);
                    }
                }
                Attribute::Dynamic(dynamic) => {
                    if has_class_bindings && dynamic.name == "class" {
                        continue;
                    }
                    let value = self.value(&dynamic.expression, dynamic.span)?;
                    let rendered = self.fail(render_value(&value), dynamic.span)?;
                    self.out.push(' ');
                    self.out.push_str(&dynamic.name);
                    self.out.push_str("=\"");
                    self.out.push_str(&rendered);
                    self.out.push('"');
                }
                Attribute::BooleanBinding(binding) => {
                    if self.value(&binding.expression, binding.span)?.truthy() {
                        self.out.push(' ');
                        self.out.push_str(&binding.name);
                    }
                }
                Attribute::AttributeBinding(binding) => {
                    let value = self.value(&binding.expression, binding.span)?;
                    if !value.is_nullish() {
                        let rendered = self.fail(render_attribute_value(&value), binding.span)?;
                        self.out.push(' ');
                        self.out.push_str(&binding.name);
                        self.out.push_str("=\"");
                        self.out.push_str(&rendered);
                        self.out.push('"');
                    }
                }
                Attribute::ClassBinding(_) => {}
            }
        }

        if element.self_closing {
            self.out.push_str("/>");
            return Ok(());
        }
        self.out.push('>');
        self.nodes(&element.children)?;
        self.out.push_str("</");
        self.out.push_str(&element.tag);
        self.out.push('>');
        Ok(())
    }

    /// Mirror of the JavaScript backend's class merging: plain and dynamic
    /// `class` values plus `[class.x]` bindings, de-duplicated in order.
    fn merged_class(&mut self, element: &ElementNode) -> RenderResult {
        let mut classes: Vec<String> = Vec::new();
        let add = |name: &str, classes: &mut Vec<String>| {
            if !classes.iter().any(|c| c == name) {
                classes.push(name.to_owned());
            }
        };

        for attribute in &element.attributes {
            match attribute {
                Attribute::Plain(plain) if plain.name == "class" => {
                    if let Some(value) = &plain.value {
                        for name in value.split_whitespace() {
                            add(name, &mut classes);
                        }
                    }
                }
                Attribute::Dynamic(dynamic) if dynamic.name == "class" => {
                    let value = self.value(&dynamic.expression, dynamic.span)?;
                    let rendered = self.fail(render_attribute_value(&value), dynamic.span)?;
                    for name in rendered.split_whitespace() {
                        add(name, &mut classes);
                    }
                }
                Attribute::ClassBinding(binding) => {
                    if self.value(&binding.expression, binding.span)?.truthy() {
                        add(&binding.name, &mut classes);
                    }
                }
                _ => {}
            }
        }

        if !classes.is_empty() {
            // Same as the JS target: values are escaped once when read and
            // once more when the joined list is written.
            let joined = Val::Json(Cow::Owned(Value::String(classes.join(" "))));
            let rendered =
                render_attribute_value(&joined).expect("string values always render as attributes");
            self.out.push_str(" class=\"");
            self.out.push_str(&rendered);
            self.out.push('"');
        }
        Ok(())
    }
}

fn invalid_iterable(source: &str, span: Span, value: &Value) -> Diagnostic {
    let kind = match value {
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        _ => "object",
    };
    Diagnostic::from_source(
        format!(
            "`@for` needs an array in static templates, found a {} value",
            kind
        ),
        source,
        span.start,
        span.end,
    )
    .with_diagnostic_code(DiagnosticCode::StaticInvalidIterable)
}

fn strict_equal(left: &Val, right: &Val) -> Result<bool, EvalError> {
    evaluator::strict_equals(left, right)
}

#[cfg(test)]
mod tests;
