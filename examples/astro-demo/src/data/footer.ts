import { site } from "./site";
import type { FooterContext } from "./types";

/**
 * Context for the Footer FlowView template.
 */
export const footerContext: FooterContext = {
  brand: site.name,
  tagline:
    "A small template compiler for HTML. Your host owns the application; FlowView owns the template.",
  columns: [
    {
      title: "Learn",
      links: [
        { label: "Getting started", href: "/getting-started" },
        { label: "Syntax", href: "/control-flow" },
        { label: "Events", href: "/events" },
        { label: "Client DOM", href: "/client-dom" },
      ],
    },
    {
      title: "Project",
      links: [
        { label: "Packages", href: "/packages" },
        { label: "Capabilities", href: "/capabilities" },
        { label: "Security", href: "/security" },
      ],
    },
    {
      title: "Community",
      links: [
        { label: "GitHub", href: site.github, external: true },
        {
          label: "Specification",
          href: `${site.github}/blob/main/docs/flowview-spec.md`,
          external: true,
        },
        {
          label: "Report a vulnerability",
          href: `${site.github}/blob/main/SECURITY.md`,
          external: true,
        },
      ],
    },
  ],
  note: `© ${new Date().getFullYear()} FlowView, MIT licensed. This site is built with Astro, FlowView and Tailwind 4.`,
};
