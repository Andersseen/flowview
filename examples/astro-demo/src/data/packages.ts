import type { PackagesContext, Recipe } from "./types";

/**
 * Package inventory derived from the workspace manifests: every `npm` entry is
 * a public, published package. `repo` and `crate-git` entries are deliberately
 * not presented as registry installs.
 */
export const packagesContext: PackagesContext = {
  groups: [
    {
      id: "core",
      title: "Core",
      summary: "The compiler and the tiny helpers its output imports.",
      packages: [
        {
          id: "flowview-compiler",
          name: "flowview-compiler (Rust)",
          status: "crate-git",
          install:
            "cargo add --git https://github.com/Andersseen/flowview flowview-compiler",
          owns: "The parser, the JavaScript backend and the native static HTML backend (compile_static).",
          whenToInstall:
            "You are embedding FlowView in a Rust tool, or rendering templates to HTML with no JavaScript engine. Not yet published on crates.io, so depend on it from Git or a path.",
          doesNotOwn:
            "Routing, Markdown, file watching or an arbitrary JavaScript engine. The static backend evaluates only a small, deterministic expression subset.",
        },
        {
          id: "compiler",
          name: "@flowview/compiler",
          status: "npm",
          install: "npm install @flowview/compiler",
          owns: "The bundled WASM build of the compiler, for tools written in JavaScript. No Rust toolchain required.",
          whenToInstall:
            "You are building your own bundler plugin or script. Vite and Astro users get it through @flowview/vite.",
          doesNotOwn:
            "Static HTML rendering (the WASM wrapper does not expose it yet) or any host integration.",
        },
        {
          id: "runtime",
          name: "@flowview/runtime",
          status: "npm",
          install: "npm install @flowview/runtime",
          owns: "The small helpers that compiled render functions import, such as value escaping.",
          whenToInstall:
            "Any project that runs compiled .flow output in JavaScript. Install it directly so your build can resolve the import.",
          doesNotOwn: "State, DOM access or a template engine of its own.",
        },
      ],
    },
    {
      id: "integrations",
      title: "Integrations",
      summary:
        "Teach a build tool to compile .flow files and embedded templates.",
      packages: [
        {
          id: "vite",
          name: "@flowview/vite",
          status: "npm",
          install: "npm install @flowview/vite @flowview/runtime",
          owns: "Compiling .flow imports to render(context) modules, with source maps. Vite 6, 7 and 8.",
          whenToInstall:
            "Vite apps, and server frameworks built on Vite such as Hono, Node.js or Cloudflare Workers projects.",
          doesNotOwn:
            "Serving, routing or deciding when your server calls render().",
        },
        {
          id: "astro",
          name: "@flowview/astro",
          status: "npm",
          install: "npm install @flowview/astro @flowview/runtime",
          owns: "<template flowview={context} is:raw> regions inside .astro files, plus standalone .flow imports. Astro 5, 6 and 7.",
          whenToInstall:
            "You author Astro pages or components and want control-flow templates.",
          doesNotOwn: "Astro's own components, islands or hydration.",
        },
      ],
    },
    {
      id: "events",
      title: "Events",
      summary:
        "Optional (event) bindings, compiled separately from the HTML templates.",
      packages: [
        {
          id: "events",
          name: "@flowview/events",
          status: "npm",
          install: "npm install @flowview/events",
          owns: "The Events compiler core and the small delegated browser runtime behind (click), (input) and friends.",
          whenToInstall:
            "Whenever you use (event) bindings. Host plugins list it as a peer or direct dependency.",
          doesNotOwn:
            "HTML compilation. The Rust compiler never parses (click); the Events compiler rewrites it first.",
        },
        {
          id: "vite-events",
          name: "@flowview/vite-events",
          status: "npm",
          install: "npm install @flowview/vite-events @flowview/events",
          owns: "Events for Vite projects. Runs before @flowview/vite and serves each <script data-flowview> block as a virtual module.",
          whenToInstall:
            "Vite or Hono apps that want (event) bindings in .flow files.",
          doesNotOwn:
            "Injecting the client script tag into your server's HTML response.",
        },
        {
          id: "astro-events",
          name: "@flowview/astro-events",
          status: "npm",
          install:
            "npm install @flowview/astro-events @flowview/events @flowview/vite-events",
          owns: "Events for .astro files and .flow imports in Astro, including View Transitions.",
          whenToInstall: "Astro sites that want (event) bindings.",
          doesNotOwn:
            "State management. Handlers are ordinary functions in your script block.",
        },
      ],
    },
    {
      id: "client",
      title: "Optional client utilities",
      summary:
        "Small, independent building blocks for browser UIs. Neither is required by the compiler.",
      packages: [
        {
          id: "dom",
          name: "@flowview/dom",
          status: "npm",
          install: "npm install @flowview/dom",
          owns: "createView(target, render) with render() and update(). Both replace the target's HTML.",
          whenToInstall:
            "You render a compiled .flow template into an element in the browser.",
          doesNotOwn: "State, reactivity, DOM diffing or a virtual DOM.",
        },
        {
          id: "reactive",
          name: "@flowview/reactive",
          status: "npm",
          install: "npm install @flowview/reactive",
          owns: "signal(), computed(), effect() and untracked(). Usable with or without FlowView.",
          whenToInstall:
            "You want fine-grained state and would rather not call view.update() by hand.",
          doesNotOwn:
            "Template reactivity. Templates never track signals; your effect() calls view.update().",
        },
      ],
    },
    {
      id: "tooling",
      title: "Tooling",
      summary: "Editor and formatting support.",
      packages: [
        {
          id: "prettier",
          name: "@flowview/prettier",
          status: "npm",
          install: "npm install -D prettier @flowview/prettier",
          owns: "Formatting .astro files while leaving FlowView template regions untouched. Prettier 3.",
          whenToInstall: "Your Astro project uses Prettier.",
          doesNotOwn: "Reformatting the contents of FlowView templates.",
        },
        {
          id: "vscode",
          name: "VS Code language support",
          status: "repo",
          owns: ".flow syntax highlighting, snippets, highlighting inside Astro template regions and raw interpolation.",
          whenToInstall:
            "Included in the repository as a local extension. It is not published to the Marketplace.",
          doesNotOwn: "Diagnostics, completion, hover or go-to-definition.",
        },
        {
          id: "cli",
          name: "flowview CLI (Rust)",
          status: "repo",
          owns: "Compiling a template to JavaScript or rendering it to static HTML from the command line.",
          whenToInstall:
            "Build it from the repository with cargo run -p flowview-cli. It is not distributed as a binary.",
          doesNotOwn: "Project scaffolding, watching or bundling.",
        },
      ],
    },
  ],
};

/** Direct dependencies for common setups, taken from the workspace examples. */
export const recipes: Recipe[] = [
  {
    id: "astro",
    goal: "Astro templates",
    install: "npm install @flowview/astro @flowview/runtime",
    note: "Embedded <template flowview> regions and standalone .flow imports.",
  },
  {
    id: "astro-events",
    goal: "Astro templates and Events",
    install:
      "npm install @flowview/astro @flowview/astro-events @flowview/events @flowview/vite-events @flowview/runtime",
    note: "@flowview/astro-events lists the Events packages as peers, so install them directly.",
  },
  {
    id: "vite",
    goal: "Vite templates",
    install: "npm install @flowview/vite @flowview/runtime",
    note: "Use it for Hono, Node.js, Workers or any Vite-built server.",
  },
  {
    id: "vite-events",
    goal: "Vite templates and Events",
    install:
      "npm install @flowview/vite @flowview/vite-events @flowview/events @flowview/runtime",
    note: "Add vite-events before vite in the plugin list.",
  },
  {
    id: "dom",
    goal: "Client rendering",
    install: "npm install @flowview/dom @flowview/vite @flowview/runtime",
    note: "createView() plus a compiled .flow render function.",
  },
  {
    id: "reactive",
    goal: "Optional state",
    install: "npm install @flowview/reactive",
    note: "Independent of the compiler and the DOM package.",
  },
];
