use crate::{
    ast::{
        Attribute, ElementNode, ForBlockNode, IfBlockNode, InterpolationMode, Node, RootNode, Span,
        SwitchBlockNode, TextNode,
    },
    CompileOptions,
};

pub fn generate(
    root: &RootNode,
    options: &CompileOptions,
    source: &str,
) -> (String, Option<String>) {
    let mut ctx = CodegenContext {
        temp_counter: 0,
        runtime_import: options.runtime_import.clone(),
        indent_cache: vec![String::new()],
        uses_raw_values: false,
        mappings: Vec::new(),
        source: if options.source_map {
            source.to_string()
        } else {
            String::new()
        },
        mapping_enabled: options.source_map,
    };

    let mut body = String::new();
    for child in &root.children {
        generate_node(child, &mut body, 2, &mut ctx);
    }

    // Only templates that opt into raw interpolation depend on `renderRawValue`,
    // so everything else keeps importing exactly what it always did.
    let imports = if ctx.uses_raw_values {
        "renderAttributeValue, renderRawValue, renderValue"
    } else {
        "renderAttributeValue, renderValue"
    };

    let code = format!(
        "import {{ {} }} from '{}';

export function render(context) {{
  let output = '';{}
  return output;
}}
",
        imports,
        escape_js_string(&ctx.runtime_import),
        if body.is_empty() {
            String::new()
        } else {
            format!("\n{}", body)
        }
    );
    let source_map = options.source_map.then(|| {
        let body_offset = if body.is_empty() {
            0
        } else {
            code.find(&body).unwrap_or(0)
        };
        build_source_map(
            &code,
            source,
            options
                .source_map_source_content
                .as_deref()
                .unwrap_or(source),
            options
                .source_map_filename
                .as_deref()
                .or(options.filename.as_deref())
                .unwrap_or("<inline>"),
            (
                options.source_map_line_offset,
                options.source_map_column_offset,
            ),
            body_offset,
            &ctx.mappings,
        )
    });
    (code, source_map)
}

struct CodegenContext {
    temp_counter: usize,
    runtime_import: String,
    indent_cache: Vec<String>,
    uses_raw_values: bool,
    mappings: Vec<Mapping>,
    source: String,
    mapping_enabled: bool,
}

#[derive(Clone, Copy)]
struct Mapping {
    generated_offset: usize,
    original_offset: usize,
}

fn mark_expression(
    output: &str,
    ctx: &mut CodegenContext,
    prefix: &str,
    expression: &str,
    span: Span,
) {
    if !ctx.mapping_enabled {
        return;
    }
    let Some(relative) = span_expression_offset(&ctx.source, span, expression) else {
        return;
    };
    ctx.mappings.push(Mapping {
        generated_offset: output.len() + prefix.len(),
        original_offset: span.start + relative,
    });
}

fn mark_span(output: &str, ctx: &mut CodegenContext, prefix: &str, span: Span) {
    if !ctx.mapping_enabled {
        return;
    }
    ctx.mappings.push(Mapping {
        generated_offset: output.len() + prefix.len(),
        original_offset: span.start,
    });
}

fn span_expression_offset(source: &str, span: Span, expression: &str) -> Option<usize> {
    source.get(span.start..span.end)?.find(expression)
}

fn build_source_map(
    code: &str,
    source: &str,
    source_content: &str,
    filename: &str,
    source_offset: (usize, usize),
    body_offset: usize,
    mappings: &[Mapping],
) -> String {
    let (line_offset, column_offset) = source_offset;
    let mut builder = sourcemap::SourceMapBuilder::new(None);
    let source_id = builder.add_source(filename);
    builder.set_source_contents(source_id, Some(source_content));
    let generated_lines = line_starts(code);
    let original_lines = line_starts(source);
    for mapping in mappings {
        let (generated_line, generated_column) = line_column(
            code,
            &generated_lines,
            body_offset + mapping.generated_offset,
        );
        let (original_line, original_column) =
            line_column(source, &original_lines, mapping.original_offset);
        builder.add_raw(
            generated_line as u32,
            generated_column as u32,
            (original_line + line_offset) as u32,
            (original_column + if original_line == 0 { column_offset } else { 0 }) as u32,
            Some(source_id),
            None,
            false,
        );
    }
    let mut json = Vec::new();
    builder
        .into_sourcemap()
        .to_writer(&mut json)
        .expect("serialize source map");
    String::from_utf8(json).expect("source map JSON is UTF-8")
}

fn line_starts(source: &str) -> Vec<usize> {
    let mut starts = vec![0];
    for (index, byte) in source.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(index + 1);
        }
    }
    starts
}

fn line_column(source: &str, starts: &[usize], offset: usize) -> (usize, usize) {
    let line = starts
        .partition_point(|start| *start <= offset)
        .saturating_sub(1);
    let column = source
        .get(starts[line]..offset)
        .map(|prefix| prefix.encode_utf16().count())
        .unwrap_or_default();
    (line, column)
}

impl CodegenContext {
    fn next_temp(&mut self, prefix: &str) -> String {
        let index = self.temp_counter;
        self.temp_counter += 1;
        format!("__{}{}", prefix, index)
    }

    fn spaces(&mut self, count: usize) -> &str {
        if count >= self.indent_cache.len() {
            for size in self.indent_cache.len()..=count {
                self.indent_cache.push(" ".repeat(size));
            }
        }
        &self.indent_cache[count]
    }
}

fn generate_node(node: &Node, output: &mut String, indent: usize, ctx: &mut CodegenContext) {
    match node {
        Node::Text(text) => generate_text(text, output, indent, ctx),
        Node::Interpolation(interp) => {
            let helper = match interp.mode {
                InterpolationMode::Escaped => "renderValue",
                InterpolationMode::Raw => {
                    ctx.uses_raw_values = true;
                    "renderRawValue"
                }
            };
            let prefix = format!("{}output += {}(", ctx.spaces(indent), helper);
            mark_expression(output, ctx, &prefix, &interp.expression, interp.span);
            let line = format!("{}{});\n", prefix, interp.expression);
            output.push_str(&line);
        }
        Node::Element(element) => generate_element(element, output, indent, ctx),
        Node::IfBlock(if_block) => generate_if_block(if_block, output, indent, ctx),
        Node::ForBlock(for_block) => generate_for_block(for_block, output, indent, ctx),
        Node::SwitchBlock(switch_block) => generate_switch_block(switch_block, output, indent, ctx),
    }
}

fn generate_text(text: &TextNode, output: &mut String, indent: usize, ctx: &mut CodegenContext) {
    if text.value.is_empty() {
        return;
    }

    let line = format!(
        "{}output += '{}';\n",
        ctx.spaces(indent),
        escape_js_string(&text.value)
    );
    let prefix = format!("{}output += '", ctx.spaces(indent));
    mark_span(output, ctx, &prefix, text.span);
    output.push_str(&line);
}

fn generate_element(
    element: &ElementNode,
    output: &mut String,
    indent: usize,
    ctx: &mut CodegenContext,
) {
    if element_is_static(element) {
        let html = render_element_to_string(element);
        let prefix = format!("{}output += '", ctx.spaces(indent));
        mark_span(output, ctx, &prefix, element.span);
        let line = format!(
            "{}output += '{}';\n",
            ctx.spaces(indent),
            escape_js_string(&html)
        );
        output.push_str(&line);
        return;
    }

    output.push_str(&format!(
        "{}output += '<{}';\n",
        ctx.spaces(indent),
        element.tag
    ));

    let has_class_bindings = element
        .attributes
        .iter()
        .any(|attr| matches!(attr, Attribute::ClassBinding(_)));

    if has_class_bindings {
        generate_class_attribute(element, output, indent, ctx);
    }

    for attribute in &element.attributes {
        match attribute {
            Attribute::Plain(plain) => {
                if has_class_bindings && plain.name == "class" {
                    continue;
                }
                let mut attr = String::new();
                attr.push(' ');
                attr.push_str(&plain.name);
                if let Some(value) = &plain.value {
                    attr.push('=');
                    attr.push(plain.quote);
                    attr.push_str(value);
                    attr.push(plain.quote);
                }
                output.push_str(&format!(
                    "{}output += '{}';\n",
                    ctx.spaces(indent),
                    escape_js_string(&attr)
                ));
            }
            Attribute::Dynamic(dynamic) => {
                if has_class_bindings && dynamic.name == "class" {
                    continue;
                }
                output.push_str(&format!(
                    "{}output += ' {}=\"';\n",
                    ctx.spaces(indent),
                    dynamic.name
                ));
                let prefix = format!("{}output += renderValue(", ctx.spaces(indent));
                mark_expression(output, ctx, &prefix, &dynamic.expression, dynamic.span);
                output.push_str(&format!("{}{});\n", prefix, dynamic.expression));
                output.push_str(&format!("{}output += '\"';\n", ctx.spaces(indent)));
            }
            Attribute::BooleanBinding(binding) => {
                let prefix = format!("{}if (", ctx.spaces(indent));
                mark_expression(output, ctx, &prefix, &binding.expression, binding.span);
                output.push_str(&format!(
                    "{}{}) output += ' {}';\n",
                    prefix, binding.expression, binding.name
                ));
            }
            Attribute::AttributeBinding(binding) => {
                let value_name = ctx.next_temp("flowview_attr");
                let prefix = format!("{}const {} = ", ctx.spaces(indent), value_name);
                mark_expression(output, ctx, &prefix, &binding.expression, binding.span);
                output.push_str(&format!("{}{};\n", prefix, binding.expression,));
                output.push_str(&format!(
                    "{}if ({} !== null && {} !== undefined) {{\n",
                    ctx.spaces(indent),
                    value_name,
                    value_name
                ));
                output.push_str(&format!(
                    "{}output += ' {}=\"';\n",
                    ctx.spaces(indent + 2),
                    binding.name
                ));
                output.push_str(&format!(
                    "{}output += renderAttributeValue({});\n",
                    ctx.spaces(indent + 2),
                    value_name
                ));
                output.push_str(&format!("{}output += '\"';\n", ctx.spaces(indent + 2)));
                output.push_str(&format!("{}}}\n", ctx.spaces(indent)));
            }
            Attribute::ClassBinding(_) => {}
        }
    }

    if element.self_closing {
        output.push_str(&format!("{}output += '/>';\n", ctx.spaces(indent)));
        return;
    }

    output.push_str(&format!("{}output += '>';\n", ctx.spaces(indent)));

    for child in &element.children {
        generate_node(child, output, indent + 2, ctx);
    }

    output.push_str(&format!(
        "{}output += '</{}>';\n",
        ctx.spaces(indent),
        element.tag
    ));
}

fn generate_class_attribute(
    element: &ElementNode,
    output: &mut String,
    indent: usize,
    ctx: &mut CodegenContext,
) {
    let classes_name = ctx.next_temp("flowview_classes");
    let seen_name = ctx.next_temp("flowview_class_seen");

    output.push_str(&format!(
        "{}const {} = [];\n",
        ctx.spaces(indent),
        classes_name
    ));
    output.push_str(&format!(
        "{}const {} = new Set();\n",
        ctx.spaces(indent),
        seen_name
    ));

    for attribute in &element.attributes {
        match attribute {
            Attribute::Plain(plain) if plain.name == "class" => {
                if let Some(value) = &plain.value {
                    for class_name in value.split_whitespace() {
                        output.push_str(&format!(
                            "{}if (!{}.has('{}')) {{ {}.add('{}'); {}.push('{}'); }}\n",
                            ctx.spaces(indent),
                            seen_name,
                            escape_js_string(class_name),
                            seen_name,
                            escape_js_string(class_name),
                            classes_name,
                            escape_js_string(class_name)
                        ));
                    }
                }
            }
            Attribute::Dynamic(dynamic) if dynamic.name == "class" => {
                let dynamic_name = ctx.next_temp("flowview_class_value");
                let prefix = format!(
                    "{}const {} = renderAttributeValue(",
                    ctx.spaces(indent),
                    dynamic_name
                );
                mark_expression(output, ctx, &prefix, &dynamic.expression, dynamic.span);
                output.push_str(&format!("{}{});\n", prefix, dynamic.expression,));
                output.push_str(&format!(
                    "{}for (const __flowview_class of {}.split(/\\s+/)) {{\n",
                    ctx.spaces(indent),
                    dynamic_name
                ));
                output.push_str(&format!(
                    "{}if (__flowview_class && !{}.has(__flowview_class)) {{ {}.add(__flowview_class); {}.push(__flowview_class); }}\n",
                    ctx.spaces(indent + 2),
                    seen_name,
                    seen_name,
                    classes_name
                ));
                output.push_str(&format!("{}}}\n", ctx.spaces(indent)));
            }
            Attribute::ClassBinding(binding) => {
                let prefix = format!("{}if (", ctx.spaces(indent));
                mark_expression(output, ctx, &prefix, &binding.expression, binding.span);
                output.push_str(&format!("{}{}) {{\n", prefix, binding.expression));
                output.push_str(&format!(
                    "{}if (!{}.has('{}')) {{ {}.add('{}'); {}.push('{}'); }}\n",
                    ctx.spaces(indent + 2),
                    seen_name,
                    escape_js_string(&binding.name),
                    seen_name,
                    escape_js_string(&binding.name),
                    classes_name,
                    escape_js_string(&binding.name)
                ));
                output.push_str(&format!("{}}}\n", ctx.spaces(indent)));
            }
            _ => {}
        }
    }

    output.push_str(&format!(
        "{}if ({}.length > 0) {{\n",
        ctx.spaces(indent),
        classes_name
    ));
    output.push_str(&format!(
        "{}output += ' class=\"';\n",
        ctx.spaces(indent + 2)
    ));
    output.push_str(&format!(
        "{}output += renderAttributeValue({}.join(' '));\n",
        ctx.spaces(indent + 2),
        classes_name
    ));
    output.push_str(&format!("{}output += '\"';\n", ctx.spaces(indent + 2)));
    output.push_str(&format!("{}}}\n", ctx.spaces(indent)));
}

fn element_is_static(element: &ElementNode) -> bool {
    element
        .attributes
        .iter()
        .all(|attr| matches!(attr, Attribute::Plain(_)))
        && element.children.iter().all(node_is_static)
}

fn node_is_static(node: &Node) -> bool {
    match node {
        Node::Text(_) => true,
        Node::Element(element) => element_is_static(element),
        _ => false,
    }
}

fn render_element_to_string(element: &ElementNode) -> String {
    let mut html = String::new();
    html.push('<');
    html.push_str(&element.tag);
    for attribute in &element.attributes {
        if let Attribute::Plain(plain) = attribute {
            html.push(' ');
            html.push_str(&plain.name);
            if let Some(value) = &plain.value {
                html.push('=');
                html.push(plain.quote);
                html.push_str(value);
                html.push(plain.quote);
            }
        }
    }
    if element.self_closing {
        html.push_str("/>");
        return html;
    }
    html.push('>');
    for child in &element.children {
        if let Node::Text(text) = child {
            html.push_str(&text.value);
        } else if let Node::Element(child_element) = child {
            html.push_str(&render_element_to_string(child_element));
        }
    }
    html.push_str("</");
    html.push_str(&element.tag);
    html.push('>');
    html
}

fn generate_if_block(
    if_block: &IfBlockNode,
    output: &mut String,
    indent: usize,
    ctx: &mut CodegenContext,
) {
    for (index, branch) in if_block.branches.iter().enumerate() {
        let keyword = if index == 0 { "if" } else { "else if" };
        let prefix = format!("{}{} (", ctx.spaces(indent), keyword);
        mark_expression(output, ctx, &prefix, &branch.condition, branch.span);
        let line = format!("{}{}) {{\n", prefix, branch.condition,);
        output.push_str(&line);

        for child in &branch.children {
            generate_node(child, output, indent + 2, ctx);
        }

        output.push_str(&format!("{}}}", ctx.spaces(indent)));

        if index < if_block.branches.len() - 1 || if_block.else_branch.is_some() {
            output.push(' ');
        } else {
            output.push('\n');
        }
    }

    if let Some(else_children) = &if_block.else_branch {
        output.push_str("else {\n");
        for child in else_children {
            generate_node(child, output, indent + 2, ctx);
        }
        output.push_str(&format!("{}}}\n", ctx.spaces(indent)));
    }
}

fn generate_for_block(
    for_block: &ForBlockNode,
    output: &mut String,
    indent: usize,
    ctx: &mut CodegenContext,
) {
    let items_name = ctx.next_temp("flowview_items");

    let prefix = format!("{}const {} = Array.from((", ctx.spaces(indent), items_name);
    mark_expression(output, ctx, &prefix, &for_block.iterable, for_block.span);
    output.push_str(&format!("{}{}) ?? []);\n", prefix, for_block.iterable));

    output.push_str(&format!(
        "{}if ({}.length === 0) {{\n",
        ctx.spaces(indent),
        items_name
    ));

    if let Some(empty_children) = &for_block.empty {
        for child in empty_children {
            generate_node(child, output, indent + 2, ctx);
        }
    }

    output.push_str(&format!("{}}} else {{\n", ctx.spaces(indent)));

    output.push_str(&format!(
        "{}for (const {} of {}) {{\n",
        ctx.spaces(indent + 2),
        for_block.item,
        items_name
    ));

    for child in &for_block.children {
        generate_node(child, output, indent + 4, ctx);
    }

    output.push_str(&format!("{}}}\n", ctx.spaces(indent + 2)));
    output.push_str(&format!("{}}}\n", ctx.spaces(indent)));
}

fn generate_switch_block(
    switch_block: &SwitchBlockNode,
    output: &mut String,
    indent: usize,
    ctx: &mut CodegenContext,
) {
    let switch_name = ctx.next_temp("flowview_switch");

    let prefix = format!("{}const {} = ", ctx.spaces(indent), switch_name);
    mark_expression(
        output,
        ctx,
        &prefix,
        &switch_block.expression,
        switch_block.span,
    );
    output.push_str(&format!("{}{};\n", prefix, switch_block.expression));

    output.push_str(&format!(
        "{}switch ({}) {{\n",
        ctx.spaces(indent),
        switch_name
    ));

    for case in &switch_block.cases {
        let prefix = format!("{}case ", ctx.spaces(indent + 2));
        mark_expression(output, ctx, &prefix, &case.expression, case.span);
        output.push_str(&format!("{}{}:\n", prefix, case.expression));

        for child in &case.children {
            generate_node(child, output, indent + 4, ctx);
        }

        output.push_str(&format!("{}break;\n", ctx.spaces(indent + 4)));
    }

    if let Some(default_children) = &switch_block.default {
        output.push_str(&format!("{}default:\n", ctx.spaces(indent + 2)));

        for child in default_children {
            generate_node(child, output, indent + 4, ctx);
        }
    }

    output.push_str(&format!("{}}}\n", ctx.spaces(indent)));
}

fn escape_js_string(value: &str) -> String {
    let mut result = String::with_capacity(value.len());

    for ch in value.chars() {
        match ch {
            '\\' => result.push_str("\\\\"),
            '\'' => result.push_str("\\'"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            '\u{2028}' => result.push_str("\\u2028"),
            '\u{2029}' => result.push_str("\\u2029"),
            character if character.is_control() => {
                result.push_str(&format!("\\u{:04x}", character as u32));
            }
            _ => result.push(ch),
        }
    }

    result
}
