use crate::{
    ast::{
        Attribute, ElementNode, ForBlockNode, IfBlockNode, Node, RootNode, SwitchBlockNode,
        TextNode,
    },
    CompileOptions,
};

pub fn generate(root: &RootNode, options: &CompileOptions) -> String {
    let mut ctx = CodegenContext {
        temp_counter: 0,
        runtime_import: options.runtime_import.clone(),
        indent_cache: vec![String::new()],
    };

    let mut body = String::new();
    for child in &root.children {
        generate_node(child, &mut body, 2, &mut ctx);
    }

    format!(
        "import {{ renderValue }} from '{}';

export function render(context) {{
  let output = '';{}
  return output;
}}
",
        escape_js_string(&ctx.runtime_import),
        if body.is_empty() {
            String::new()
        } else {
            format!("\n{}", body)
        }
    )
}

struct CodegenContext {
    temp_counter: usize,
    runtime_import: String,
    indent_cache: Vec<String>,
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
            let line = format!(
                "{}output += renderValue({});\n",
                ctx.spaces(indent),
                interp.expression
            );
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

    for attribute in &element.attributes {
        match attribute {
            Attribute::Plain(plain) => {
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
                output.push_str(&format!(
                    "{}output += ' {}=\"';\n",
                    ctx.spaces(indent),
                    dynamic.name
                ));
                output.push_str(&format!(
                    "{}output += renderValue({});\n",
                    ctx.spaces(indent),
                    dynamic.expression
                ));
                output.push_str(&format!("{}output += '\"';\n", ctx.spaces(indent)));
            }
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
        let line = format!(
            "{}{} ({}) {{\n",
            ctx.spaces(indent),
            keyword,
            branch.condition
        );
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
    let items_name = ctx.next_temp("flowmark_items");

    output.push_str(&format!(
        "{}const {} = Array.from(({}) ?? []);\n",
        ctx.spaces(indent),
        items_name,
        for_block.iterable
    ));

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
    let switch_name = ctx.next_temp("flowmark_switch");

    output.push_str(&format!(
        "{}const {} = {};\n",
        ctx.spaces(indent),
        switch_name,
        switch_block.expression
    ));

    output.push_str(&format!(
        "{}switch ({}) {{\n",
        ctx.spaces(indent),
        switch_name
    ));

    for case in &switch_block.cases {
        output.push_str(&format!(
            "{}case {}:\n",
            ctx.spaces(indent + 2),
            case.expression
        ));

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
