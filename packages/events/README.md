# @flowview/events

FlowView Events compiles `(event)="handler(...)"` template attributes into
native delegated event listeners. Handlers live in one `<script data-flowview>`
block in each `.flow` or `.astro` file.

```flow
<form (submit)="submit($event, $el)">
  <input (input)="edit($event, $el)" />
  <button (click)="save('draft', $el)">Save</button>
</form>

<script data-flowview>
  function submit(event, form) {
    event.preventDefault();
    const values = new FormData(form);
  }
  function edit(event, element) { console.log(element.value); }
  function save(name, element) { console.log(name, element); }
</script>
```

Arguments are limited to `$event`, `$el`, JSON-compatible literals and
template-scope property paths. `$event` and `$el` remain the native browser
objects. FlowView does not automatically prevent default actions, update
application state, or keep controls synchronized with template attributes.

The runtime supports native `click`, `input`, `change`, `submit`, `keydown`,
`focus`, `blur`, `focusin`, `focusout`, `compositionstart`,
`compositionupdate`, `compositionend` and `toggle` events. Delegation keeps
handlers available on replacement nodes. `focus`, `blur` and non-bubbling
`toggle` are observed in the capture phase. Applications must not replace an
actively edited/composing input unless they accept losing its live state and
focus/selection continuity. Chromium acceptance is not a cross-browser promise.

Use the corresponding integration package to compile bindings in an app:
`@flowview/astro-events` or `@flowview/vite-events`.
