import { site } from "./site";
import type { FooterContext } from "./types";

/**
 * Context for the Footer flowview template.
 */
export const footerContext: FooterContext = {
  brand: site.title,
  tagline: site.tagline,
  links: [
    { label: "GitHub", href: site.github, external: true },
    { label: "Docs", href: site.docs, external: true },
  ],
  copyright: `© ${new Date().getFullYear()} flowview. Built with Astro, flowview, Tailwind 4, and Andersseen Web Components.`,
};
