# flowview-static-runtime

Small runtime for rendering FlowView templates compiled ahead of time by the
FlowView compiler. It intentionally does not parse `.flow` source or depend on
Oxc. See the repository's Rust embedding guide for the AOT workflow.

This crate is part of the FlowView 0.x release line and its artifact format may
change between minor releases. Regenerate artifacts when upgrading the runtime.
