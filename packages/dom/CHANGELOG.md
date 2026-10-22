# @flowview/dom

## 0.3.0

### Minor Changes

- 2937a38: Define native form-control behavior with explicit DOM replacement, and delegate non-bubbling details toggle events through capture.

## 0.2.0

### Minor Changes

- dd3687a: Add scoped DOM references, exclusive view ownership, nested disposal, and a
  structural reactive binding API. Harden initial synchronous subscription errors
  so failed view renders do not leave Signal or Computed observers attached.

## 0.1.0

### Minor Changes

- e62d2c4: Add `@flowview/dom`, a tiny client-side DOM runtime that connects compiled Flowview render functions to native DOM targets. Also teach the Astro Events integration to install `.flow` event support so client-rendered Flowview DOM updates keep delegated handlers working.

## 0.1.0

### Minor Changes

- Add a tiny client-side DOM runtime for compiled flowview render functions.
