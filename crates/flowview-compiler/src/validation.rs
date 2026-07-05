use crate::{
    ast::{ForBlockNode, Node, RootNode},
    diagnostics::{Diagnostic, DiagnosticCode, DiagnosticSeverity},
};

/// Collect non-fatal warnings about constructs that are parsed correctly but
/// have no runtime effect in the current compiler version.
pub fn validate(root: &RootNode, source: &str) -> Vec<Diagnostic> {
    let mut warnings = Vec::new();
    for child in &root.children {
        validate_node(child, source, &mut warnings);
    }
    warnings
}

fn validate_node(node: &Node, source: &str, warnings: &mut Vec<Diagnostic>) {
    match node {
        Node::ForBlock(for_block) => validate_for_block(for_block, source, warnings),
        Node::Element(element) => {
            for child in &element.children {
                validate_node(child, source, warnings);
            }
        }
        Node::IfBlock(if_block) => {
            for branch in &if_block.branches {
                for child in &branch.children {
                    validate_node(child, source, warnings);
                }
            }
            if let Some(children) = &if_block.else_branch {
                for child in children {
                    validate_node(child, source, warnings);
                }
            }
        }
        Node::SwitchBlock(switch_block) => {
            for case in &switch_block.cases {
                for child in &case.children {
                    validate_node(child, source, warnings);
                }
            }
            if let Some(children) = &switch_block.default {
                for child in children {
                    validate_node(child, source, warnings);
                }
            }
        }
        Node::Text(_) | Node::Interpolation(_) => {}
    }
}

fn validate_for_block(for_block: &ForBlockNode, source: &str, warnings: &mut Vec<Diagnostic>) {
    if for_block.track.is_some() {
        warnings.push(
            Diagnostic::from_source(
                "`track` is reserved and has no runtime effect in flowview v1",
                source,
                for_block.span.start,
                for_block.span.end,
            )
            .with_severity(DiagnosticSeverity::Warning)
            .with_diagnostic_code(DiagnosticCode::TrackIgnored),
        );
    }

    for child in &for_block.children {
        validate_node(child, source, warnings);
    }
    if let Some(children) = &for_block.empty {
        for child in children {
            validate_node(child, source, warnings);
        }
    }
}
