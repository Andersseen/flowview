---
"@flowview/prettier": patch
---

Fix formatting `.astro` files whose FlowView regions or preceding source contain multi-byte characters (emoji, accents). The Astro parser reports UTF-8 byte offsets, which were used as UTF-16 string indexes and leaked trailing markup into the preserved region.
