import type { SiteMeta } from "./types";

/**
 * Global site metadata used across the landing page and Layout.
 */
export const site: SiteMeta = {
  title: "flowview",
  tagline:
    "HTML-like templates with modern control flow. Compiled to plain JavaScript.",
  description:
    "flowview is a framework-agnostic template language with @if, @for, and @switch, compiled by Rust and embedded in Astro.",
  url: "https://flowview.example",
  github: "https://github.com/andersseen/flowview",
  docs: "https://github.com/andersseen/flowview#readme",
};
