# M2 — Browser Composition

**Status:** implementation decision for M2 on the pre-1.0 roadmap.

## Reference marker

Use the ordinary HTML attribute `data-flow-ref="name"`. A new `#ref` or
`@ref` token would create compiler syntax, parser and editor contracts, and
static-target questions without improving the ownership model. The marker works
as ordinary HTML in JavaScript and static output and is visible in rendered DOM.
The compiler assigns no special meaning to it.

## Scope and lookup

Each `createView()` owns one exact target Element. A weak registry prevents two
active views from owning the same root and identifies active nested roots without
writing metadata onto DOM nodes. Lookup enumerates `data-flow-ref` attributes in
the view subtree and compares attribute values directly, so ref names are not
interpolated into CSS selectors.

`ref(name)` returns `null` for no match, the Element for one match, and an
actionable error for multiple matches. `refs(name)` returns all current matches
in DOM order. Loop refs therefore use an explicit collection API; no synthetic
keys or `track`-based identity is introduced. Conditional refs exist only in
their current branch. Sibling views are isolated. An outer view may refer to a
nested view root carrying its own ref, but lookup stops before nested contents.

## Replacement and nested ownership

`render()` and `update()` keep assigning rendered strings to `innerHTML`. Ref
results are snapshots and can become detached on the next replacement; callers
look them up again. Before an outer root replaces its content or is disposed, it
disposes active descendant views so their subscriptions stop before their DOM is
removed. `dispose()` itself leaves the root's current DOM in place, is
idempotent, releases ownership, and makes the view terminal.

## Reactive bridge

DOM exports the structural contract `FlowviewValueSource<T>` with
`subscribe(callback): () => void`. `Signal<T>` and `Computed<T>` already meet
it and synchronously emit their current value, so `view.bind(source)` performs
the initial render synchronously and follows subsequent synchronous emissions.
DOM has no runtime dependency on Reactive, and Reactive remains independent of
DOM. Reactive subscription implementations detach the observer if an immediate
initial callback throws, so a failed initial view render does not leave a live
subscription behind.

One binding may be active per view. `stop()` is idempotent and disconnects only
the source, allowing manual updates or a later binding. `dispose()` stops the
binding and terminates ownership. Render errors propagate to the caller and do
not silently alter the current DOM or hide the error.

## Events and rejected alternatives

Events keeps its existing delegated document listeners and ownership model; it
continues to handle replacement nodes without a second DOM-package lifecycle.
No `$ref`/`$refs` handler arguments are added. New template syntax, synthetic
keys, DOM preservation, reconciliation, a VDOM, hydration, component lifecycle
hooks and automatic signal reads were rejected as outside M2 and contrary to
FlowView's string-renderer model.
