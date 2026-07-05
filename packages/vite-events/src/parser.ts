export interface ScriptFlowviewBlock {
  /** Start offset of the opening `<script` tag. */
  elementStart: number;
  /** End offset (exclusive) of the closing `</script>` tag. */
  elementEnd: number;
  /** Span of the `data-flowview` attribute, including a leading space if any. */
  flowviewAttributeStart: number;
  flowviewAttributeEnd: number;
  /** Inner text content of the `<script>` element. */
  scriptSource: string;
  scriptContentStart: number;
  scriptContentEnd: number;
}

export class FlowviewViteEventsParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "FlowviewViteEventsParseError";
  }
}

const FLOWVIEW_ATTRIBUTE = "data-flowview";

/**
 * Locates every `<script data-flowview>` block in raw `.flow` source text.
 * `.flow` files have no frontmatter or AST, so a small raw-text scan
 * (mirroring `findEventBindings` in `@flowview/events`) is sufficient.
 */
export function findScriptFlowviewBlocks(
  source: string,
): ScriptFlowviewBlock[] {
  const blocks: ScriptFlowviewBlock[] = [];
  let index = 0;

  while (index < source.length) {
    if (source.slice(index, index + 4) === "<!--") {
      index = skipHtmlComment(source, index);
      continue;
    }

    if (isTagStart(source, index, "style")) {
      index = skipRawTextElement(source, index, "style");
      continue;
    }

    if (isTagStart(source, index, "script")) {
      const tagEnd = findTagEnd(source, index);
      if (tagEnd === -1) break;

      const close = findRawTextClose(source, tagEnd + 1, "script");
      const contentEnd = close?.contentEnd ?? source.length;
      const elementEnd = close?.elementEnd ?? source.length;

      const attribute = findAttribute(
        source,
        index,
        tagEnd,
        FLOWVIEW_ATTRIBUTE,
      );
      if (attribute !== undefined) {
        if (attribute.value !== null) {
          throw new FlowviewViteEventsParseError(
            "The `data-flowview` attribute on <script> must not have a value.",
            attribute.nameStart,
          );
        }

        const flowviewAttributeStart =
          source[attribute.nameStart - 1] === " "
            ? attribute.nameStart - 1
            : attribute.nameStart;

        blocks.push({
          elementStart: index,
          elementEnd,
          flowviewAttributeStart,
          flowviewAttributeEnd: attribute.nameEnd,
          scriptSource: source.slice(tagEnd + 1, contentEnd),
          scriptContentStart: tagEnd + 1,
          scriptContentEnd: contentEnd,
        });
      }

      index = elementEnd;
      continue;
    }

    index += 1;
  }

  return blocks;
}

function skipHtmlComment(source: string, start: number): number {
  const end = source.indexOf("-->", start + 4);
  return end === -1 ? source.length : end + 3;
}

function isTagStart(source: string, start: number, tagName: string): boolean {
  const open = `<${tagName}`;
  const slice = source.slice(start, start + open.length).toLowerCase();
  if (slice !== open) return false;
  const next = source[start + open.length];
  return next === undefined || /[\s>]/.test(next);
}

function skipRawTextElement(
  source: string,
  start: number,
  tagName: string,
): number {
  const tagEnd = findTagEnd(source, start);
  if (tagEnd === -1) return source.length;
  const close = findRawTextClose(source, tagEnd + 1, tagName);
  return close?.elementEnd ?? source.length;
}

function findRawTextClose(
  source: string,
  contentStart: number,
  tagName: string,
): { contentEnd: number; elementEnd: number } | undefined {
  const close = `</${tagName}>`;
  const closeIndex = source.toLowerCase().indexOf(close, contentStart);
  if (closeIndex === -1) return undefined;
  return { contentEnd: closeIndex, elementEnd: closeIndex + close.length };
}

/** Finds the `>` that ends the tag starting at `start`, respecting quoted attribute values. */
function findTagEnd(source: string, start: number): number {
  let index = start + 1;
  let inString: string | undefined;

  while (index < source.length) {
    const char = source[index];

    if (inString !== undefined) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === inString) inString = undefined;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      index += 1;
      continue;
    }

    if (char === ">") return index;

    index += 1;
  }

  return -1;
}

interface FoundAttribute {
  nameStart: number;
  nameEnd: number;
  value: string | null;
}

function findAttribute(
  source: string,
  tagStart: number,
  tagEnd: number,
  attributeName: string,
): FoundAttribute | undefined {
  let index = tagStart + 1;

  // Skip the tag name.
  while (index < tagEnd && !/[\s>]/.test(source[index]!)) index += 1;

  while (index < tagEnd) {
    index = skipWhitespace(source, index, tagEnd);
    if (index >= tagEnd) break;

    const char = source[index];
    if (char === "/" || char === ">") break;

    const nameStart = index;
    while (index < tagEnd && !/[\s=/>]/.test(source[index]!)) index += 1;
    const name = source.slice(nameStart, index);
    const nameEnd = index;

    index = skipWhitespace(source, index, tagEnd);

    let value: string | null = null;
    if (source[index] === "=") {
      index += 1;
      index = skipWhitespace(source, index, tagEnd);
      const parsed = parseAttributeValue(source, index, tagEnd);
      value = parsed.value;
      index = parsed.end;
    }

    if (name === attributeName) {
      return { nameStart, nameEnd, value };
    }
  }

  return undefined;
}

function skipWhitespace(source: string, start: number, end: number): number {
  let index = start;
  while (index < end && /\s/.test(source[index]!)) index += 1;
  return index;
}

function parseAttributeValue(
  source: string,
  start: number,
  end: number,
): { value: string; end: number } {
  const quote = source[start];
  if (quote === '"' || quote === "'" || quote === "`") {
    let index = start + 1;
    while (index < end) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === quote) {
        return { value: source.slice(start + 1, index), end: index + 1 };
      }
      index += 1;
    }
    return { value: source.slice(start + 1, index), end: index };
  }

  let index = start;
  while (index < end && !/[\s>]/.test(source[index]!)) index += 1;
  return { value: source.slice(start, index), end: index };
}
