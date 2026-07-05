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

Values interpolated from `ctx` are escaped by default through the runtime
helpers.

## Context-Specific Safety

The runtime performs HTML escaping. It does not sanitize URL schemes, CSS, or
JavaScript. In particular, HTML escaping alone cannot make untrusted values safe
inside `<script>` or `<style>` elements, `on*` event attributes, or URL-bearing
attributes such as `href` and `src`.

Validate values for their destination context. Prefer interpolation in normal
text and quoted ordinary data attributes; unquoted attribute interpolation is
rejected by the compiler. flowview does not currently provide a raw HTML escape
hatch or context-aware URL/CSS/JavaScript sanitizers.
