# Security Policy

flowview is an early-stage compiler project. Please report security issues
privately before opening public issues.

## Supported Versions

The project has not reached a stable release yet. Security fixes target the
default branch until a release policy exists.

## Reporting a Vulnerability

Please include:

- A short description of the issue
- A minimal reproduction
- The affected package or crate
- Any known impact or workaround

Do not include exploit details in public issues until the vulnerability has
been reviewed.

## Template Trust Model

`.flow` templates are trusted source code. flowview preserves expressions as
JavaScript source strings in generated render functions. Do not compile
user-submitted templates unless you sandbox the generated code yourself.

Values interpolated with `{{ ... }}` are escaped by default through the runtime
helpers (and by the static HTML renderer, which applies the same rules).

## Raw HTML Interpolation (`{{{ ... }}}`)

```text
{{ value }}     → safe-by-default escaped interpolation
{{{ value }}}   → explicit raw HTML interpolation
```

`{{{ value }}}` means: _I, the template author, explicitly assert that this
value is already trusted or sanitized HTML, and I want flowview to insert it
verbatim._ flowview does not sanitize raw values, does not inspect them, and
never turns an ordinary value into raw HTML on its own.

This is unsafe if the value is not trustworthy:

```text
<!-- XSS: if context.userSuppliedHtml was not sanitized by the caller -->
<div>{{{ context.userSuppliedHtml }}}</div>
```

With `userSuppliedHtml` set to `<img src=x onerror=alert(1)>`, the markup is
emitted as written and runs in the visitor's browser. Sanitize with a
purpose-built HTML sanitizer, or produce the HTML from a source you control,
_before_ passing it to flowview. flowview deliberately offers no sanitizer, no
sanitizing expression (`{{{ sanitize(x) }}}` is rejected by the static target
and is not special in the JavaScript target), and no configuration option that
disables escaping globally.

The existence of raw interpolation does not weaken `{{ ... }}`. Escaped
interpolation behaves exactly as before, and the choice is made visibly at the
exact template location. Raw interpolation is only accepted in element content;
it is rejected inside tag names, attribute names, and attribute values, and it
is not interpreted inside HTML comments, `<script>`, or `<style>`. Only
strings (or `null`, `undefined`, `false`) are accepted; other values are errors
rather than being stringified into markup.

## Context-Specific Safety

The runtime performs HTML escaping. It does not sanitize URL schemes, CSS, or
JavaScript. In particular, HTML escaping alone cannot make untrusted values safe
inside `<script>` or `<style>` elements, `on*` event attributes, or URL-bearing
attributes such as `href` and `src`.

Validate values for their destination context. Prefer interpolation in normal
text and quoted ordinary data attributes; unquoted attribute interpolation is
rejected by the compiler. The only unescaped path is explicit `{{{ ... }}}`
(see above). flowview does not provide HTML, URL, CSS, or JavaScript sanitizers.
