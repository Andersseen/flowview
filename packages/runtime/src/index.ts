export { escapeHtml } from "./escape-html";
export { renderValue } from "./render-value";

/**
 * Generic shape of the context object passed to a generated render function.
 */
export type RenderContext = Record<string, unknown>;

/**
 * Type of a generated Flowmark render function.
 */
export type RenderFunction<C extends RenderContext = RenderContext> = (
  context: C,
) => string;
