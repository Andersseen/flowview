/** Convert a Rust UTF-8 byte offset into a JavaScript UTF-16 code-unit offset. */
export function utf8ByteOffsetToCodeUnit(source, byteOffset) {
  let bytes = 0;
  let codeUnits = 0;
  for (const character of source) {
    if (bytes >= byteOffset) break;
    bytes += utf8Length(character.codePointAt(0) ?? 0xfffd);
    codeUnits += character.length;
  }
  return codeUnits;
}

function utf8Length(codePoint) {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}
