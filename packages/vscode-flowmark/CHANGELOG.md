# Change Log

## Unreleased

- Use theme-compatible TextMate scopes for every Flowmark control keyword.
- Mark interpolations and control expressions as embedded JavaScript regions.
- Improve Astro injection around quoted and braced attributes.
- Make the Astro snippet emit the complete
  `<template flowmark is:raw context={...}>` editor-compatible wrapper.
- Add executable grammar checks.

## 0.1.0

- Initial release.
- Syntax highlighting for Flowmark templates (`.flow`).
- Highlighting for interpolations (`{{ ... }}`), control flow (`@if`, `@else if`, `@else`, `@for`, `@empty`, `@switch`, `@case`, `@default`) and JavaScript expressions inside parentheses.
- Support for escaped markers (`\@`, `\{`, `\}`, `\\`).
- Grammar injection for inline Flowmark inside Astro `<template flowmark>` blocks.
- Legacy grammar injection for inline Flowmark inside Astro `<Flowmark is:raw>` blocks.
- Snippets for Flowmark and Astro usage.
