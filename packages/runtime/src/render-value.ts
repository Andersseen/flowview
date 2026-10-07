import { escapeHtml } from "./escape-html";

export function renderValue(value: unknown): string {
  return escapeHtml(value);
}

export function renderAttributeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return escapeHtml(String(value));
}

/**
 * Insert an already-trusted HTML fragment verbatim. Backs `{{{ expression }}}`.
 *
 * This performs NO escaping and NO sanitization: the template author asserts
 * the value is trusted or already sanitized HTML. Passing user-supplied markup
 * here is a cross-site scripting vulnerability.
 *
 * Deliberately narrow contract: only strings are inserted. `null`, `undefined`
 * and `false` render as an empty string (like {@link renderValue}). Every
 * other value throws a `TypeError` rather than being stringified, so a number,
 * array or object never turns into markup by accident.
 */
export function renderRawValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined || value === false) {
    return "";
  }

  const kind = Array.isArray(value) ? "array" : typeof value;
  throw new TypeError(
    `Raw interpolation {{{ }}} requires a string, null, undefined or false, but received a value of type ${kind}.`,
  );
}
