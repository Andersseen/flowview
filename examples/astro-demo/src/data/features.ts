import type { FeaturesContext } from "./types";

/**
 * Context for the Features flowview template.
 */
export const featuresContext: FeaturesContext = {
  items: [
    {
      id: "control-flow",
      title: "Modern control flow",
      description:
        "Write @if, @else if, @for, @empty, and @switch blocks that read like the host language you already know.",
      badge: "@if @for @switch",
    },
    {
      id: "rust-compiler",
      title: "Rust compiler",
      description:
        "Templates are parsed and compiled to plain JavaScript render functions at build time. No runtime parser, no VDOM.",
      badge: "Build-time",
    },
    {
      id: "framework-agnostic",
      title: "Framework agnostic",
      description:
        "Use flowview as standalone .flow files with Vite or embed regions directly inside Astro components.",
      badge: "Astro + Vite",
    },
    {
      id: "secure",
      title: "Secure by default",
      description:
        "Interpolated values are HTML-escaped automatically. Templates are trusted source code, not user input.",
      badge: "Escaping",
    },
  ],
};
