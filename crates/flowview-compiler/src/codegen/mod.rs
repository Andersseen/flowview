//! Code generation backends.
//!
//! Every backend consumes the same AST produced by the shared parser.

pub mod javascript;

pub use javascript::generate;
