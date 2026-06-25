/**
 * Global site metadata used for SEO, navigation, and CTAs.
 */
export interface SiteMeta {
  title: string;
  tagline: string;
  description: string;
  url: string;
  github: string;
  docs: string;
}

/**
 * Context passed to the Hero Flowmark template.
 */
export interface HeroContext {
  title: string;
  tagline: string;
  ctaPrimary: { text: string; href: string };
  ctaSecondary?: { text: string; href: string };
}

/**
 * A single feature card rendered by the Features Flowmark template.
 */
export interface Feature {
  id: string;
  title: string;
  description: string;
  badge?: string;
}

/**
 * Context passed to the Features Flowmark template.
 */
export interface FeaturesContext {
  items: Feature[];
}

/**
 * Identifiers for syntax examples shown in the Syntax Showcase.
 */
export type SyntaxExampleId = "for" | "if" | "switch";

/**
 * A single syntax example rendered by the Syntax Showcase Flowmark template.
 */
export interface SyntaxExample {
  id: SyntaxExampleId;
  label: string;
  code: string;
  description: string;
}

/**
 * Context passed to the Syntax Showcase Flowmark template.
 */
export interface SyntaxShowcaseContext {
  examples: SyntaxExample[];
}

/**
 * A single step in the Getting Started section.
 */
export interface Step {
  label: string;
  code: string;
  description: string;
  className?: string;
}

/**
 * Context passed to the Getting Started Flowmark template.
 */
export interface GettingStartedContext {
  title: string;
  description: string;
  steps: Step[];
}

/**
 * A single footer link.
 */
export interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

/**
 * Context passed to the Footer Flowmark template.
 */
export interface FooterContext {
  brand: string;
  tagline: string;
  links: FooterLink[];
  copyright: string;
}
