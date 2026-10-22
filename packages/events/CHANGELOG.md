# @flowview/events

## 0.2.0

### Minor Changes

- 2937a38: Define native form-control behavior with explicit DOM replacement, and delegate non-bubbling details toggle events through capture.

## 0.1.2

### Patch Changes

- 473d06c: Export `hashScope`, the 12-hex-character file-path hashing helper used to
  compute `data-flow-scope` ids, so integrations beyond `@flowview/astro-events`
  (such as `@flowview/vite-events`) don't need their own copy.
