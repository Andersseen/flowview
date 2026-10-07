# @flowview/compiler

## 0.2.0

### Minor Changes

- 2d5ec40: Add raw HTML interpolation, `{{{ expression }}}`, as an explicit, narrowly
  scoped language addition. `{{ expression }}` still escapes exactly as before.
  `@flowview/runtime` gains `renderRawValue` (strings are returned unchanged,
  `null`/`undefined`/`false` render as an empty string, every other value throws a
  `TypeError`); generated modules import it only when a template uses `{{{ }}}`,
  so upgrade `@flowview/runtime` together with `@flowview/compiler`. Raw
  interpolation is rejected in tag names, attribute names, and attribute values
  (`FV0022`). flowview does not sanitize raw values: only pass HTML you trust.

## 0.1.2

### Patch Changes

- Republish to sync every package's version and GitHub Release alongside
  `@flowview/events` and `@flowview/vite-events`. No functional changes.
