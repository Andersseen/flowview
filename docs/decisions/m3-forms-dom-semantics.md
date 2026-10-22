# M3 — Forms and DOM Replacement Semantics

**Status:** implementation decision for M3 on the pre-1.0 roadmap.

## Decision

Keep the browser architecture as `render(context) -> HTML string` followed by
`root.innerHTML` replacement. Use existing ordinary attributes, boolean
attribute bindings, FlowView Events, and M2 scoped refs. Add no general property
binding, form helper, two-way binding, or reconciler API.

HTML attributes seed the browser's default state when new controls are parsed.
Browser interactions update live DOM properties. Such changes do not generally
rewrite the source attributes or default properties. A later FlowView update
creates new Elements from the new HTML and therefore applies newly rendered
defaults.

## Native-control matrix

The rows below are observed in Chromium by
`examples/astro-demo/e2e/forms.spec.ts`.

| Control              | Rendered source                                           | Initial/default browser state                                                                          | After user interaction                                                                              | Native reset                                                                   | FlowView replacement                                                |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Text input           | `value="{{ context.name }}"`                              | `value` attribute, `defaultValue`, and live `value` start equal                                        | Typing changes live `value`; the attribute and `defaultValue` stay as rendered                      | Restores `defaultValue`                                                        | Replaces the Element and initializes from the new `value` attribute |
| Textarea             | Interpolated element text                                 | Text content, `defaultValue`, and live `value` start equal; a `value` attribute does not set the value | Editing changes live `value`, not default text/content                                              | Restores the text-content default                                              | Replaces the Element and initializes from newly rendered text       |
| Checkbox             | `[checked]` boolean attribute                             | `checked` attribute initializes `defaultChecked` and `checked`                                         | Toggle changes `checked`; attribute and `defaultChecked` remain unchanged                           | Restores `defaultChecked`                                                      | New checkbox starts from the rendered `checked` attribute           |
| Radio                | `value` plus `[checked]`                                  | Checked attribute initializes `defaultChecked`; native same-name group rules apply                     | Selecting another radio changes live `checked` state                                                | Restores checked defaults subject to group rules                               | Recreates the radio group from rendered markup                      |
| Single select/option | `[selected]` on options                                   | Selected attribute initializes `defaultSelected` and selection                                         | Changing selection updates `select.value` and `option.selected`; attributes/defaults remain         | Restores option defaults                                                       | Recreates selection from the rendered option attributes             |
| Multiple select      | `multiple` and selected option attributes                 | `multiple` sets the native property; selected attributes seed `defaultSelected` and selected options   | `selectedOptions` changes independently from selected attributes                                    | Restores selected defaults                                                     | Recreates the options and selection from markup                     |
| Details              | `[open]` boolean attribute                                | `open` attribute initializes the `open` property                                                       | `open` is reflected: toggling updates both the live property and attribute                          | `form.reset()` does not reset details                                          | New details element starts from the newly rendered `open` attribute |
| Disabled / required  | Static or FlowView boolean attributes                     | Presence sets the native `disabled` / `required` properties                                            | Native browser validation and submission rules apply; disabled controls are omitted from `FormData` | Native reset does not change these attributes                                  | New controls use the rendered attributes                            |
| Form / button        | Ordinary HTML `name`, `type`, and submit/reset attributes | Browser supplies native form behavior                                                                  | Events handlers receive native events and Elements                                                  | `form.reset()` restores native control defaults; no FlowView reset abstraction | Form content is replaced with the rest of the view                  |

`[checked]`, `[selected]`, `[open]`, `[disabled]` and `[required]` continue to
mean HTML boolean-attribute serialization. They do not assign or maintain a
live DOM property. `value="{{ ... }}"` remains escaped HTML attribute
interpolation. Textarea defaults come from text content, not a `value`
attribute. No compiler serialization or JS/static parity behavior changes.

## Editing, commit and replacement

Controls have two useful application boundaries:

- During active editing, the browser owns the live control property. Keep the
  draft local and avoid replacing that control for each keystroke when focus and
  selection matter.
- At an explicit commit such as submit, the application can call
  `preventDefault()`, read `FormData`, update application state, and then call
  `view.update()` or update a bound source. Replacement starts fresh controls
  from the rendered state.

`view.bind(source)` synchronously replaces the whole view on every source
emission. Connecting an input event directly to a signal bound to that view can
detach the focused input after the first edit. This is documented and shown in
the acceptance fixture as a caution, not hidden by changing M2.

Replacement detaches old controls and old refs. Values held only in browser
properties are discarded. Focus, selection/caret, and IME composition are not
preserved. Applications reacquire refs after replacement. The composition test
dispatches browser `CompositionEvent`s in Chromium to verify delegated event
delivery and the no-replacement editing boundary; it does not emulate an OS
input method or claim IME continuity across replacement.

## Events

Existing handler syntax and arguments stay unchanged. The Events runtime
supports `click`, `input`, `change`, `submit`, `keydown`, `focus`, `blur`,
`focusin`, `focusout`, composition start/update/end and `toggle`. `$event` and
`$el` remain native browser objects. JSON literals and template-scope property
paths remain supported. Submit is not implicitly prevented; handlers decide
whether to call `preventDefault()` and may use `FormData`. Delegated handlers
survive replacement. Since focus, blur and details toggle do not bubble in the
tested browser, delegated observation for them uses capture.

The real-browser matrix is Chromium only. It proves the tested behavior there;
it does not promise identical focus, caret, selection or composition behavior
across browsers. The Astro demo remains the product acceptance harness, and the
existing Hono/Vite Events suite remains the independent integration regression.

## Alternatives rejected

- **General DOM property binding** (`[property.foo]`, `[value]` or equivalent):
  unnecessary for these patterns because scoped refs expose live native
  properties. It would expand compiler/static semantics and unsafe assignment
  surfaces.
- **Two-way binding or form state helpers:** rejected because applications own
  state and choose update boundaries.
- **DOM preservation, keys, reconciliation, VDOM or focus/caret/IME restoration:**
  rejected because they change the approved replacement architecture and add
  identity/lifecycle contracts.
- **Implicit submit prevention or FlowView reset behavior:** rejected in favor
  of native browser behavior and explicit handler decisions.
