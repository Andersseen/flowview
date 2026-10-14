import type { SiteMeta } from "./types";

/**
 * Global site metadata. `url` is the production deployment (Cloudflare Pages
 * project `flowview-demo`); no custom domain is configured.
 */
export const site: SiteMeta = {
  name: "FlowView",
  title: "FlowView",
  tagline: "Modern template DX for HTML, without adopting a framework.",
  description:
    "FlowView is a Rust template compiler for HTML with @if, @for and @switch. Render from Astro, Vite, Hono, Workers or native Rust, with optional Events, DOM and reactive utilities.",
  url: "https://flowview-demo.pages.dev",
  github: "https://github.com/andersseen/flowview",
  docs: "https://github.com/andersseen/flowview#readme",
};

/** `Title · FlowView` for inner pages; the bare name on the home page. */
export function pageTitle(title?: string): string {
  return title ? `${title} · ${site.name}` : `${site.name} — ${site.tagline}`;
}
