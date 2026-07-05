import { site } from "./site";
import type { HeroContext } from "./types";

/**
 * Context for the Hero flowview template.
 */
export const heroContext: HeroContext = {
  title: site.title,
  tagline: site.tagline,
  ctaPrimary: { text: "Get started", href: "#getting-started" },
  ctaSecondary: { text: "View on GitHub", href: site.github },
};
