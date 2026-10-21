import assert from "node:assert/strict";
import test from "node:test";
import { utf8ByteOffsetToCodeUnit } from "../src/offsets.mjs";
import {
  compileFlowview,
  FlowviewCompilerError,
} from "../../compiler/dist/index.js";

test("maps byte spans to UTF-16 positions across ASCII and Unicode", () => {
  const source = "Aé€漢🙂👩‍💻�error";
  const prefix = source.slice(0, source.indexOf("error"));
  const start = Buffer.byteLength(prefix, "utf8");
  const end = start + Buffer.byteLength("error", "utf8");
  assert.equal(utf8ByteOffsetToCodeUnit(source, start), prefix.length);
  assert.equal(utf8ByteOffsetToCodeUnit(source, end), prefix.length + 5);
});

test("maps ranges after a ZWJ sequence", () => {
  const source = "é🙂👩‍💻x";
  const prefix = "é🙂👩‍💻";
  assert.equal(
    utf8ByteOffsetToCodeUnit(source, Buffer.byteLength(prefix)),
    prefix.length,
  );
});

// @spec SPEC-HTML-102
test("compiler error spans map to exact UTF-16 editor offsets", () => {
  const source = "é€漢🙂👩‍💻�\n<div>{{ }}</div>";
  let diagnostics;
  try {
    compileFlowview(source, { filename: "unicode.flow" });
    assert.fail("expected the compiler to reject the empty expression");
  } catch (error) {
    assert.ok(error instanceof FlowviewCompilerError);
    diagnostics = error.diagnostics;
  }
  const diagnostic = diagnostics.find((item) => item.code === "FV0005");
  assert.ok(diagnostic);
  const start = utf8ByteOffsetToCodeUnit(source, diagnostic.start);
  const end = utf8ByteOffsetToCodeUnit(source, diagnostic.end);
  assert.equal(source.slice(start, end), "{{ ");
  assert.equal(source.slice(0, start).split("\n")[1]?.length, 5);
});
