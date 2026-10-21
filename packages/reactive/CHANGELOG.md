# @flowview/reactive

## 0.1.1

### Patch Changes

- dd3687a: Add scoped DOM references, exclusive view ownership, nested disposal, and a
  structural reactive binding API. Harden initial synchronous subscription errors
  so failed view renders do not leave Signal or Computed observers attached.

## 0.1.0

### Minor Changes

- e9dab48: Add `@flowview/reactive`, an optional, dependency-free `signal()` / `computed()` / `effect()` / `untracked()` package for applications that want to reduce manual state/update plumbing around `view.update()`. It is framework-, DOM- and Astro-agnostic and neither `@flowview/dom`, the compiler, nor Flowview Events depend on it.
