# @flowview/runtime

The runtime contains the small HTML escaping and value helpers used by
FlowView-generated render functions. It does not parse templates, compile code,
or provide a sanitizer.

```ts
import {
  renderValue,
  renderAttributeValue,
  renderRawValue,
} from "@flowview/runtime";

renderValue("<script>"); // &lt;script&gt;
renderRawValue("<b>trusted</b>"); // <b>trusted</b>
```

FlowView templates are trusted source. Ordinary interpolation (`{{ value }}`)
escapes HTML by default. Raw interpolation (`{{{ value }}}`) is explicit and
must receive an already trusted or sanitized string. Passing untrusted markup
to it can cause cross-site scripting. `@flowview/runtime` is not a sanitizer.

Mixed static text plus interpolation in one attribute value is unsupported by
the compiler. The optional `track` expression is accepted but has no rendering
effect; the compiler reports warning `FV0015`.

See the root [FlowView guide](../../README.md) and
[security model](../../SECURITY.md).
