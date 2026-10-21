# @flowview/astro-events

The Astro integration for FlowView Events checks event bindings against
functions declared in `<script data-flowview>` and connects valid handlers to
the delegated `@flowview/events` runtime.

`analyzeAstroEvents(source, filename)` runs the same transform pipeline used by
the integration and returns `{ diagnostics, code, map }`. It is intended for
editor integrations that need compiler-owned diagnostics and the transformed
source map. It parses trusted source only; it does not evaluate handlers.

Events errors are reported with their original filename and host-file line and
column. Astro transformations preserve source maps so later FlowView compiler
diagnostics can be attributed to the original document.

See the root [FlowView guide](../../README.md) for Astro setup and
[Events documentation](../../docs/flowview-spec.md#events).
