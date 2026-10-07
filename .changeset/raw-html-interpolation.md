---
"@flowview/runtime": minor
"@flowview/compiler": minor
---

Add raw HTML interpolation, `{{{ expression }}}`, as an explicit, narrowly
scoped language addition. `{{ expression }}` still escapes exactly as before.
`@flowview/runtime` gains `renderRawValue` (strings are returned unchanged,
`null`/`undefined`/`false` render as an empty string, every other value throws a
`TypeError`); generated modules import it only when a template uses `{{{ }}}`,
so upgrade `@flowview/runtime` together with `@flowview/compiler`. Raw
interpolation is rejected in tag names, attribute names, and attribute values
(`FV0022`). flowview does not sanitize raw values: only pass HTML you trust.
