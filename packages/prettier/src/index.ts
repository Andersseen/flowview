import type { AstPath, Doc, Options, Plugin, Printer } from "prettier";
import { doc } from "prettier";
import * as astroPluginModule from "prettier-plugin-astro";

// prettier-plugin-astro ships a CommonJS build; support both interop shapes.
const astroPlugin: Plugin =
  (astroPluginModule as { default?: Plugin }).default ??
  (astroPluginModule as unknown as Plugin);

/**
 * Prettier plugin for flowview templates inside Astro files.
 *
 * It wraps prettier-plugin-astro so that `.astro` files format exactly as
 * before, except that `<template flowview …>` regions are preserved
 * byte-for-byte. flowview control-flow syntax (`@if`, `@for`, `{{ … }}`) is
 * not HTML that Prettier understands, so reflowing it corrupts templates;
 * this plugin removes the need for `<!-- prettier-ignore -->` comments.
 *
 * Usage (replaces prettier-plugin-astro in the plugins list):
 *
 * ```json
 * { "plugins": ["@flowview/prettier"] }
 * ```
 */

interface AstroNode {
  type?: string;
  name?: string;
  attributes?: Array<{ name?: string }>;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

function isFlowviewTemplate(node: unknown): node is AstroNode {
  const candidate = node as AstroNode | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.type === "element" &&
    candidate.name === "template" &&
    Array.isArray(candidate.attributes) &&
    candidate.attributes.some((attribute) => attribute.name === "flowview")
  );
}

function rawSourceRange(node: AstroNode): [number, number] | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) {
    return undefined;
  }
  return [start, end];
}

function hasFlowviewAncestor(path: AstPath<unknown>): boolean {
  for (let depth = 0; ; depth += 1) {
    const parent = path.getParentNode(depth);
    if (parent === null || parent === undefined) return false;
    if (isFlowviewTemplate(parent)) return true;
  }
}

const astroPrinter = astroPlugin.printers?.["astro"] as Printer<unknown>;

/**
 * prettier-plugin-astro arms module-level state when it prints a
 * `<!-- prettier-ignore -->` comment and consumes it on the next node it
 * prints. If that next node is a flowview template we must delegate instead
 * of short-circuiting, so the Astro printer consumes its own flag (it
 * preserves the node verbatim anyway). Otherwise the armed flag leaks into
 * the next file formatted by the same process and crashes it.
 */
function isPrecededByPrettierIgnore(path: AstPath<unknown>): boolean {
  const parent = path.getParentNode() as { children?: unknown[] } | null;
  const siblings = parent?.children;
  if (!Array.isArray(siblings)) return false;

  const index = siblings.indexOf(path.node);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const sibling = siblings[cursor] as {
      type?: string;
      value?: string;
    } | null;
    if (sibling?.type === "text" && sibling.value?.trim() === "") continue;
    return (
      sibling?.type === "comment" &&
      sibling.value?.trim().startsWith("prettier-ignore") === true
    );
  }
  return false;
}

const flowviewAstroPrinter: Printer<unknown> = {
  ...astroPrinter,

  print(path, options, print, args): Doc {
    const node = path.node as unknown;
    if (isFlowviewTemplate(node) && !isPrecededByPrettierIgnore(path)) {
      const range = rawSourceRange(node);
      if (range !== undefined) {
        const raw = (options.originalText as string).slice(range[0], range[1]);
        return doc.utils.replaceEndOfLine(raw);
      }
    }
    return astroPrinter.print(path, options, print, args);
  },

  embed(path: AstPath<unknown>, options: Options) {
    // Never let the Astro printer format expressions or raw text inside a
    // flowview region; the region is emitted verbatim by `print` above.
    if (isFlowviewTemplate(path.node) || hasFlowviewAncestor(path)) {
      return null;
    }
    return astroPrinter.embed?.(path, options) ?? null;
  },
};

const plugin: Plugin = {
  languages: astroPlugin.languages,
  options: astroPlugin.options,
  defaultOptions: astroPlugin.defaultOptions,
  parsers: astroPlugin.parsers,
  printers: {
    ...astroPlugin.printers,
    astro: flowviewAstroPrinter,
  },
};

export default plugin;
export const { languages, options, defaultOptions, parsers, printers } = plugin;
