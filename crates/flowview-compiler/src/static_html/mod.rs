//! Static HTML backend: `template + JSON context → HTML string`.
//!
//! This backend shares the parser and AST with the JavaScript backend. It
//! evaluates only the constrained expression subset described in
//! `docs/flowview-spec.md` and never executes JavaScript.

mod evaluator;

use std::{borrow::Cow, collections::HashMap};

use serde_json::Value;

use crate::{
    ast::{Attribute, ElementNode, InterpolationMode, Node, RootNode, Span},
    diagnostics::{Diagnostic, DiagnosticCode},
    parser, validation,
};
use evaluator::{
    eval, lower, render_attribute_value, render_raw_value, render_value, EvalError, Expr, Scope,
    Val,
};

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

/// A template that has been parsed, validated and expression-lowered once.
///
/// It owns everything needed to render (AST, source text for diagnostics,
/// lowered expressions, compile-time warnings), so the original source string
/// may be dropped. It is immutable: [`render`](Self::render) borrows it and
/// keeps all per-render state (scope, output) local to the call, so one
/// compiled template can render any number of contexts, from any thread.
#[derive(Debug)]
pub struct CompiledStaticTemplate {
    source: String,
    root: RootNode,
    exprs: Exprs,
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
        let root = parser::parse(source)?;
        let warnings = validation::validate(&root, source);

        let mut exprs = HashMap::new();
        let mut errors = Vec::new();
        collect_root(&root, source, &mut exprs, &mut errors);
        if !errors.is_empty() {
            return Err(errors);
        }

        Ok(Self {
            source: source.to_owned(),
            root,
            exprs,
            warnings,
            filename: options.filename,
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
        check_context(context)?;
        let mut renderer = Renderer {
            template: self,
            scope: Scope::new(context),
            out: String::new(),
        };
        renderer
            .nodes(&self.root.children)
            .map_err(|diagnostic| vec![diagnostic])?;
        Ok(renderer.out)
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

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/// Per-render state. Borrows the immutable template; owns only the scope and
/// output buffer.
struct Renderer<'t, 'a> {
    template: &'t CompiledStaticTemplate,
    scope: Scope<'a>,
    out: String,
}

type RenderResult = Result<(), Diagnostic>;

impl<'a> Renderer<'_, 'a> {
    fn source(&self) -> &str {
        &self.template.source
    }

    fn value(&self, expression: &str, span: Span) -> Result<Val<'a>, Diagnostic> {
        let expr = self
            .template
            .exprs
            .get(expression)
            .expect("expression lowered in pre-pass");
        eval(expr, &self.scope).map_err(|e| to_diagnostic(e, self.source(), span))
    }

    fn fail<T>(&self, result: Result<T, EvalError>, span: Span) -> Result<T, Diagnostic> {
        result.map_err(|e| to_diagnostic(e, self.source(), span))
    }

    fn nodes(&mut self, nodes: &[Node]) -> RenderResult {
        nodes.iter().try_for_each(|node| self.node(node))
    }

    fn node(&mut self, node: &Node) -> RenderResult {
        match node {
            Node::Text(text) => self.out.push_str(&text.value),
            Node::Interpolation(i) => {
                let value = self.value(&i.expression, i.span)?;
                let rendered = self.fail(
                    match i.mode {
                        InterpolationMode::Escaped => render_value(&value),
                        InterpolationMode::Raw => render_raw_value(&value),
                    },
                    i.span,
                )?;
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
                            return Err(invalid_iterable(self.source(), block.span, &other));
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
        let source = self.template.source.as_str();
        self.out.push('<');
        let tag_name = source_tag_name(element.span, source)
            .unwrap_or(&element.tag)
            .to_owned();
        self.out.push_str(&tag_name);

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
                    let name = source_attribute_name(plain.span, source).unwrap_or(&plain.name);
                    self.out.push_str(name);
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
        self.out.push_str(&tag_name);
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
                    let active = self.value(&binding.expression, binding.span)?.truthy();
                    if active {
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

#[cfg(test)]
mod compiled_tests;
