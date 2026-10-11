---
"@flowview/compiler": patch
---

Fix malformed templates containing multibyte Unicode (including U+FFFD) being
able to panic the compiler while building diagnostics. Compiler errors now
always report spans on valid UTF-8 character boundaries.
