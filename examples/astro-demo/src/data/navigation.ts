import { site } from "./site";

/**
 * Navigation items passed to the `<and-navbar>` component in Layout.
 */
export const navItems = [
  { id: "home", label: "Home", href: "/" },
  {
    id: "github",
    label: "GitHub",
    href: site.github,
    target: "_blank",
  },
];
