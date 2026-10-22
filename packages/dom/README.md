# @flowview/dom

`@flowview/dom` writes the HTML returned by a compiled FlowView render function
into one native DOM element. It does not compile templates or depend on a
reactive package.

```ts
import { createView } from "@flowview/dom";
import { render } from "./items.flow";

const view = createView("#items", render);
view.render({ items: [] });
view.update({ items: [{ id: 1, name: "Ship it" }] });
```

Both `render()` and `update()` replace `innerHTML`. Nodes do not survive an
update, so Elements returned by refs are snapshots of the current render. Read
the refs again after replacement.

## Scoped references

Mark ordinary template elements with `data-flow-ref`:

```flow
<p data-flow-ref="summary">{{ context.items.length }} items</p>

@for (item of context.items) {
  <li data-flow-ref="item">{{ item.name }}</li>
}
```

`view.ref<TElement>(name)` returns the one matching current Element, or `null`
if absent. It throws when multiple elements have that name; use
`view.refs<TElement>(name)` to get every match in DOM order. Ref names are
compared as attribute values, not interpolated into selectors. Conditional refs
are absent when their branch is not rendered. Refs never cross into an active
nested view. An outer view can still reference the nested view root itself when
that root has a ref attribute.

## Binding and ownership

`view.bind(source)` accepts any source with a `subscribe(callback)` method that
returns an unsubscribe function. The source emits its current value on
subscription, so binding performs the initial render synchronously. FlowView
`Signal` and `Computed` values satisfy this contract without a runtime package
dependency from DOM to Reactive.

The returned `stop()` is idempotent. It disconnects the source while leaving
manual `render()` and `update()` available. A view accepts one active binding at
a time.

`view.dispose()` is idempotent, stops its binding, disposes active nested views,
and releases root ownership. It leaves rendered DOM in place. Disposed views
reject further operations. Only one active view can own a root element; dispose
the current owner before reusing it. Parent replacement also disposes active
descendant views before replacing their subtree.

FlowView Events keeps using its delegated event listeners across replacement;
DOM views do not create or own another Events lifecycle. FlowView remains a
string renderer with no virtual DOM, reconciler, hydration or implicit component
lifecycle.

## Native form controls

Bindings such as `[checked]`, `[selected]`, `[open]`, `[disabled]` and
`[required]` serialize ordinary HTML boolean attributes. They seed the browser's
initial and default control state; they do not keep live DOM properties bound
after user interaction.

```flow
<input data-flow-ref="name" value="{{ context.name }}" />
<textarea data-flow-ref="notes">{{ context.notes }}</textarea>
<input type="checkbox" [checked]="context.enabled" />
<option value="south" [selected]="context.region === 'south'">South</option>
<details [open]="context.showDetails">...</details>
```

For textareas, render the initial value as element text, not a `value` attribute.
The browser may change `input.value`, `checked`, `select.value` and
`option.selected` while the corresponding attributes/default properties remain
unchanged. `form.reset()` restores native controls to their HTML defaults.

Read a live value through a scoped native reference when needed:

```ts
const name = view.ref<HTMLInputElement>("name");
const draft = name?.value;
```

Keep active typing browser-local and commit at an explicit event boundary, such
as form submit. `view.bind(source)` synchronously replaces the entire view on
every source emission; connecting each keystroke to a bound source can detach
the focused input immediately. Every `render()` or `update()` also replaces
controls, losing their local dirty values and node identity. Focus, selection,
caret and IME composition are not automatically restored. Reacquire refs after
replacement. There is no two-way binding, form state model, validation layer,
general property setter, or reconciliation.

FlowView Events does not prevent form submission. A handler chooses whether to
call `event.preventDefault()` and can read current controls with native APIs
such as `new FormData(form)`. See the browser-tested acceptance example in
`examples/astro-demo/e2e/forms.spec.ts`.
