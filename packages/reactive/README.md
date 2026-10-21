# @flowview/reactive

`@flowview/reactive` is an optional, dependency-free state library. It works on
its own and has no dependency on the DOM package.

```ts
import { computed, effect, signal, untracked } from "@flowview/reactive";

const count = signal(1);
const doubled = computed(() => count() * 2);
const stop = effect(() => console.log(doubled()));

count.set(2);
stop();
const snapshot = untracked(() => count());
```

- `signal(value)` creates a readable and writable value with `set()`,
  `update()`, `peek()` and `subscribe()`.
- `computed(fn)` lazily derives a read-only value and exposes `peek()` and
  `subscribe()`.
- `effect(fn)` runs immediately and tracks signal/computed reads; its returned
  function stops the effect and runs its last cleanup.
- `untracked(fn)` reads values without adding dependencies to the active effect
  or computed.

`subscribe(callback)` synchronously calls the callback with the current value,
then calls it when the value changes. A signal or computed can be passed directly
to `view.bind(source)` from `@flowview/dom`; Reactive has no DOM runtime
dependency. Manual `effect(() => view.update(value()))` composition remains
available when it suits the application.

These primitives do not make FlowView templates implicitly reactive. The
application owns its state and explicitly chooses when to bind or update a view.
