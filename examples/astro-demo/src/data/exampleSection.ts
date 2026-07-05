export interface Release {
  id: string;
  version: string;
  date: string;
  title: string;
  summary: string;
  kind: "feature" | "fix" | "docs";
  breaking?: boolean;
}

export interface ExampleSectionContext {
  title: string;
  description: string;
  releases: Release[];
}

export const exampleSectionContext: ExampleSectionContext = {
  title: "Real-world example",
  description:
    "A changelog list rendered with flowview control flow inside an Astro component.",
  releases: [
    {
      id: "v0-2-0",
      version: "0.2.0",
      date: "2026-06-24",
      title: "Structured HTML and serializable diagnostics",
      summary:
        "The parser now understands tags and attributes, and diagnostics carry precise spans and stable error codes.",
      kind: "feature",
      breaking: true,
    },
    {
      id: "v0-1-3",
      version: "0.1.3",
      date: "2026-06-20",
      title: "Shared JavaScript expression scanner",
      summary:
        "Interpolation, parenthesized expressions, and for-headers now share one scanner for strings, comments, regex, and template literals.",
      kind: "fix",
    },
    {
      id: "v0-1-0",
      version: "0.1.0",
      date: "2026-06-15",
      title: "Astro integration and inline authoring",
      summary:
        "Embed flowview regions directly inside .astro files with <template flowview={context} is:raw>.",
      kind: "feature",
    },
    {
      id: "v0-0-5",
      version: "0.0.5",
      date: "2026-06-10",
      title: "Documentation and security policy",
      summary:
        "Added the specification, security model, and contribution guidelines.",
      kind: "docs",
    },
  ],
};
