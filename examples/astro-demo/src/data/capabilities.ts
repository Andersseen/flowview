/**
 * Typed capability inventory rendered by the `/capabilities` page through a
 * FlowView template. Evidence is declared by hand and must only list what the
 * repository actually exercises; see the evidence legend on the page.
 */
export type EvidenceKind =
  | "live-demo"
  | "browser-e2e"
  | "compiler-spec"
  | "release-compat";

export interface Capability {
  id: string;
  group: string;
  title: string;
  description: string;
  /** Deeper existing page, when one exists. */
  route?: string;
  evidence: EvidenceKind[];
}

export interface CapabilityGroup {
  id: string;
  title: string;
  items: Capability[];
}

export interface EvidenceLegendEntry {
  kind: EvidenceKind;
  label: string;
  meaning: string;
}

export interface CapabilitiesContext {
  evidence: EvidenceLegendEntry[];
  groups: CapabilityGroup[];
}

export const evidenceLegend: EvidenceLegendEntry[] = [
  {
    kind: "live-demo",
    label: "Live demo",
    meaning: "Rendered by real FlowView output on this site.",
  },
  {
    kind: "browser-e2e",
    label: "Browser E2E",
    meaning: "Asserted in a real browser against this site.",
  },
  {
    kind: "compiler-spec",
    label: "Compiler/spec",
    meaning: "Covered by Rust and spec-conformance tests.",
  },
  {
    kind: "release-compat",
    label: "Release compatibility",
    meaning: "Checked with packed consumers before release.",
  },
];

const ALL_RENDERED: EvidenceKind[] = [
  "live-demo",
  "browser-e2e",
  "compiler-spec",
];

export const capabilityGroups: CapabilityGroup[] = [
  {
    id: "compiler",
    title: "Template compiler",
    items: [
      {
        id: "escaped",
        group: "compiler",
        title: "Escaped interpolation",
        description: "{{ value }} always becomes text, never markup.",
        route: "#interpolation",
        evidence: ALL_RENDERED,
      },
      {
        id: "raw",
        group: "compiler",
        title: "Raw interpolation",
        description:
          "{{{ value }}} inserts trusted, author-controlled HTML. FlowView does not sanitize it.",
        route: "#interpolation",
        evidence: ALL_RENDERED,
      },
      {
        id: "if",
        group: "compiler",
        title: "@if / @else",
        description: "Conditional blocks, in both build-time and client views.",
        route: "/client-dom",
        evidence: ALL_RENDERED,
      },
      {
        id: "for",
        group: "compiler",
        title: "@for / @empty",
        description:
          "Keyed loops with an empty fallback, including transitions.",
        route: "/client-dom",
        evidence: ALL_RENDERED,
      },
      {
        id: "switch",
        group: "compiler",
        title: "@switch",
        description: "@case and @default branches.",
        route: "#switch",
        evidence: ALL_RENDERED,
      },
      {
        id: "bindings",
        group: "compiler",
        title: "Boolean, attribute and class bindings",
        description: "[disabled], [attr.aria-busy] and [class.active].",
        route: "/client-dom",
        evidence: ALL_RENDERED,
      },
    ],
  },
  {
    id: "astro",
    title: "Astro integration",
    items: [
      {
        id: "embedded",
        group: "astro",
        title: "Embedded Astro template",
        description:
          "<template flowview={context} is:raw> inside a .astro file. This page is built with it.",
        route: "/inline",
        evidence: ["live-demo", "browser-e2e", "release-compat"],
      },
      {
        id: "standalone",
        group: "astro",
        title: "Standalone .flow file",
        description: "A compiled .flow module imported by application code.",
        route: "/client-dom",
        evidence: ["live-demo", "browser-e2e", "release-compat"],
      },
    ],
  },
  {
    id: "events",
    title: "Events",
    items: [
      {
        id: "click-input",
        group: "events",
        title: "(click) and (input)",
        description: "Native, delegated listeners declared in the template.",
        route: "/events",
        evidence: ALL_RENDERED,
      },
      {
        id: "arguments",
        group: "events",
        title: "$event, $el and literal arguments",
        description:
          "Handlers receive the event, the element or serialized values.",
        route: "/events",
        evidence: ALL_RENDERED,
      },
      {
        id: "scopes",
        group: "events",
        title: "Scope isolation",
        description:
          "Same-named handlers in different templates do not collide.",
        route: "/events#scopes",
        evidence: ["live-demo", "browser-e2e"],
      },
    ],
  },
  {
    id: "client",
    title: "Client DOM and reactivity",
    items: [
      {
        id: "dom",
        group: "client",
        title: "@flowview/dom",
        description:
          "createView() owns one target and exposes scoped refs, binding, and disposal while rendering fresh HTML.",
        route: "/client-dom",
        evidence: ["live-demo", "browser-e2e"],
      },
      {
        id: "reactive",
        group: "client",
        title: "@flowview/reactive",
        description:
          "An independent signal library. A value can bind directly to a view, or be used without DOM.",
        route: "/client-dom",
        evidence: ["live-demo", "browser-e2e"],
      },
      {
        id: "dynamic",
        group: "client",
        title: "Events after DOM replacement",
        description: "Delegated handlers keep working with no rebinding code.",
        route: "/client-dom#dynamic",
        evidence: ["live-demo", "browser-e2e"],
      },
    ],
  },
  {
    id: "safety",
    title: "Safety and integration",
    items: [
      {
        id: "xss",
        group: "safety",
        title: "Escaped by default",
        description: "Hostile values in {{ }} render as inert text.",
        route: "/security",
        evidence: ALL_RENDERED,
      },
      {
        id: "unicode",
        group: "safety",
        title: "Unicode and literal markers",
        description:
          "Multi-byte text survives; marker-looking text stays literal.",
        route: "#unicode",
        evidence: ALL_RENDERED,
      },
      {
        id: "view-transitions",
        group: "safety",
        title: "Astro View Transitions",
        description: "Event handling survives client-side navigation.",
        route: "/events#scopes",
        evidence: ["live-demo", "browser-e2e"],
      },
      {
        id: "static",
        group: "safety",
        title: "Native static rendering",
        description:
          "The Rust compile_static backend renders the same language without Node. It is verified by Rust and spec tests, not by this site.",
        evidence: ["compiler-spec"],
      },
    ],
  },
];

export const capabilitiesContext: CapabilitiesContext = {
  evidence: evidenceLegend,
  groups: capabilityGroups,
};

export const interpolationContext = {
  /** Authored, trusted markup. FlowView does not sanitize `{{{ }}}`. */
  html: "<strong>Hello</strong>",
  hostile: `<img src=x onerror="globalThis.__flowviewCapabilitiesXss = true">`,
};

export const switchContext = {
  statuses: ["draft", "published", "archived", "something-else"],
};

export const unicodeContext = {
  samples: ["é", "€", "🙂", "�"],
  markers: ["@if", "{{ value }}", "{{{ value }}}"],
};
