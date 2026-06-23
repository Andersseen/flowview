use crate::{
    ast::{ForBlockNode, IfBlockNode, Node, RootNode, SwitchBlockNode, TextNode},
    CompileOptions,
};

pub fn generate(root: &RootNode, options: &CompileOptions) -> String {
    let mut ctx = CodegenContext {
        temp_counter: 0,
        runtime_import: options.runtime_import.clone(),
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
}

impl CodegenContext {
    fn next_temp(&mut self, prefix: &str) -> String {
        let index = self.temp_counter;
        self.temp_counter += 1;
        format!("__{}{}", prefix, index)
    }
}

fn generate_node(node: &Node, output: &mut String, indent: usize, ctx: &mut CodegenContext) {
    match node {
        Node::Text(text) => generate_text(text, output, indent),
        Node::Interpolation(interp) => {
            let line = format!(
                "{}output += renderValue({});\n",
                spaces(indent),
                interp.expression
            );
            output.push_str(&line);
        }
        Node::IfBlock(if_block) => generate_if_block(if_block, output, indent, ctx),
        Node::ForBlock(for_block) => generate_for_block(for_block, output, indent, ctx),
        Node::SwitchBlock(switch_block) => generate_switch_block(switch_block, output, indent, ctx),
    }
}

fn generate_text(text: &TextNode, output: &mut String, indent: usize) {
    if text.value.is_empty() {
        return;
    }

    let line = format!(
        "{}output += '{}';\n",
        spaces(indent),
        escape_js_string(&text.value)
    );
    output.push_str(&line);
}

fn generate_if_block(
    if_block: &IfBlockNode,
    output: &mut String,
    indent: usize,
    ctx: &mut CodegenContext,
) {
    for (index, branch) in if_block.branches.iter().enumerate() {
        let keyword = if index == 0 { "if" } else { "else if" };
        let line = format!("{}{} ({}) {{\n", spaces(indent), keyword, branch.condition);
        output.push_str(&line);

        for child in &branch.children {
            generate_node(child, output, indent + 2, ctx);
        }

        output.push_str(&format!("{}}}", spaces(indent)));

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
        output.push_str(&format!("{}}}\n", spaces(indent)));
    }
}

fn generate_for_block(
    for_block: &ForBlockNode,
    output: &mut String,
    indent: usize,
    ctx: &mut CodegenContext,
) {
    let items_name = ctx.next_temp("items");

    output.push_str(&format!(
        "{}const {} = Array.from(({}) ?? []);\n",
        spaces(indent),
        items_name,
        for_block.iterable
    ));

    output.push_str(&format!(
        "{}if ({}.length === 0) {{\n",
        spaces(indent),
        items_name
    ));

    if let Some(empty_children) = &for_block.empty {
        for child in empty_children {
            generate_node(child, output, indent + 2, ctx);
        }
    }

    output.push_str(&format!("{}}} else {{\n", spaces(indent)));

    output.push_str(&format!(
        "{}for (const {} of {}) {{\n",
        spaces(indent + 2),
        for_block.item,
        items_name
    ));

    for child in &for_block.children {
        generate_node(child, output, indent + 4, ctx);
    }

    output.push_str(&format!("{}}}\n", spaces(indent + 2)));
    output.push_str(&format!("{}}}\n", spaces(indent)));
}

fn generate_switch_block(
    switch_block: &SwitchBlockNode,
    output: &mut String,
    indent: usize,
    ctx: &mut CodegenContext,
) {
    let switch_name = ctx.next_temp("switch");

    output.push_str(&format!(
        "{}const {} = {};\n",
        spaces(indent),
        switch_name,
        switch_block.expression
    ));

    output.push_str(&format!("{}switch ({}) {{\n", spaces(indent), switch_name));

    let last_case_index = switch_block.cases.len().saturating_sub(1);

    for (index, case) in switch_block.cases.iter().enumerate() {
        output.push_str(&format!(
            "{}case {}:\n",
            spaces(indent + 2),
            case.expression
        ));

        for child in &case.children {
            generate_node(child, output, indent + 4, ctx);
        }

        let is_last = index == last_case_index && switch_block.default.is_none();
        if !is_last {
            output.push_str(&format!("{}break;\n", spaces(indent + 4)));
        }
    }

    if let Some(default_children) = &switch_block.default {
        output.push_str(&format!("{}default:\n", spaces(indent + 2)));

        for child in default_children {
            generate_node(child, output, indent + 4, ctx);
        }
    }

    output.push_str(&format!("{}}}\n", spaces(indent)));
}

fn spaces(count: usize) -> String {
    " ".repeat(count)
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
