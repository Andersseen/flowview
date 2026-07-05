# Changelog

All notable changes to flowview will be documented in this file.

This project does not have a stable release yet.

## Unreleased

- Added `@flowview/vite-events`, bringing flowview Events'
  `(click)="handler()"` bindings to plain Vite projects (Hono, Node.js,
  Cloudflare Workers) without requiring Astro. Bindings are rewritten to
  `data-flow-on-*` attributes before `@flowview/vite` compiles the template,
  and the `<script data-flowview>` block is served as a
  `virtual:flowview-events/` module for the client build.
- Added `examples/hono-demo`, a worked Vite + Hono example for flowview
  Events without Astro, with a Playwright suite covering click, input, and
  post-load DOM delegation.
- Exported `hashScope` from `@flowview/events`, the file-path hashing helper
  used to compute `data-flow-scope` ids, so new integrations don't need their
  own copy.
- Added `@flowview/prettier`, a Prettier plugin that wraps
  prettier-plugin-astro and preserves `<template flowview …>` regions
  byte-for-byte, removing the need for `<!-- prettier-ignore -->` comments.
  The repo, demo, and docs now format without any ignore comments, and the
  plugin guards against prettier-plugin-astro's module-level
  `prettier-ignore` state leaking across files.
- Fixed the VS Code extension development scripts to pass an absolute
  `--extensionDevelopmentPath`, which VS Code requires.
- Added the `<template flowview={context} is:raw>` shorthand: the `flowview`
  attribute now accepts the context expression directly, `context={...}`
  remains supported, and combining both is a compile error. Docs, demo, and
  editor snippets use the short form.
- Replaced the events-compiler global/reserved-word allowlists with real
  TypeScript scope analysis: browser globals such as `IntersectionObserver`
  are no longer false capture errors, shadowed locals are allowed, and
  imported frontmatter values are correctly reported as captures.
- Extracted frontmatter handler functions with the TypeScript AST instead of
  regular expressions, so `function` text inside comments and strings is
  ignored and parameter default values are preserved in the client module.
- Analyzed all event handlers with a single TypeScript program per compile
  instead of one per handler.
- Added a spec-driven development guide (`docs/spec-driven-development.md`)
  and removed the superseded events-compiler plan document.
- Validated embedded JavaScript expressions with a production JavaScript parser
  before generating modules.
- Kept control-flow markers literal inside HTML attributes, comments, scripts,
  styles, and word-like text such as email addresses.
- Replaced Astro template discovery with the official Astro parser and added
  source maps for `.astro` pre-transforms.
- Added structured CLI diagnostics, asynchronous cached compiler execution, and
  location-aware Vite errors.
- Added a real Vite build fixture and TypeScript declarations for `.flow`
  imports.
- Preserved observable whitespace after completed `@if` and `@for` blocks while
  still allowing whitespace before `@else`, `@empty`, and `@else if`.
- Required explicit closing braces before `@else`, `@else if`, and `@empty`.
- Hardened JavaScript-expression scanning for nested template literals and
  regular expressions after expression-leading keywords.
- Hardened Astro inline-template discovery around comments, raw-text elements,
  nested templates, tag-name boundaries, and frontmatter insertion.
- Added focused Astro transformation tests and generated-code execution tests.
- Added an editor-compatible Astro authoring wrapper, executable VS Code grammar
  tests, and a clean `astro check` gate for the demo.
- Migrated every demo page-content surface to inline flowview in `.astro` files.
- Preserved template whitespace exactly instead of collapsing individual text nodes.
- Hardened interpolation escaping for unquoted HTML attributes and documented
  context-specific security limits.
- Added validation for loop bindings and empty expressions.
- Added stdin compilation and display-name/line-offset diagnostics to the CLI.
- Removed `cargo run` and temporary-file compilation from the Astro integration.
- Added content-addressed virtual modules for reliable Astro development updates.
- Added the `@flowview/vite` package and a tested standalone `.flow` import path.
- Added a Rust compiler crate for `.flow` templates.
- Added a CLI for compiling templates to JavaScript render functions.
- Added a small TypeScript runtime for escaped interpolation.
- Added support for `@if`, `@else if`, `@else`, `@for`, `@empty`, and `@switch`.
- Added an Astro demo using Andersseen Web Components and Tailwind CSS.
