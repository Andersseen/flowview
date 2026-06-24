import { site } from "./site";
import type { FooterContext } from "./types";

/**
 * Context for the Footer Flowmark template.
 */
export const footerContext: FooterContext = {
  brand: site.title,
  tagline: site.tagline,
  links: [
    { label: "GitHub", href: site.github, external: true },
    { label: "Docs", href: site.docs, external: true },
    { label: "Live demo", href: "#live-demo" },
  ],
  copyright: `© ${new Date().getFullYear()} Flowmark. Built with Astro, Flowmark, Tailwind 4, and Andersseen Web Components.`,
};
