---
"@flowview/dom": minor
"@flowview/reactive": patch
---

Add scoped DOM references, exclusive view ownership, nested disposal, and a
structural reactive binding API. Harden initial synchronous subscription errors
so failed view renders do not leave Signal or Computed observers attached.
