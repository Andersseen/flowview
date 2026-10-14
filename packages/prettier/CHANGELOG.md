# @flowview/prettier

## 0.1.3

### Patch Changes

- 98e538d: Fix formatting `.astro` files whose FlowView regions or preceding source contain multi-byte characters (emoji, accents). The Astro parser reports UTF-8 byte offsets, which were used as UTF-16 string indexes and leaked trailing markup into the preserved region.

## 0.1.2

### Patch Changes

- Republish to sync every package's version and GitHub Release alongside
  `@flowview/events` and `@flowview/vite-events`. No functional changes.
