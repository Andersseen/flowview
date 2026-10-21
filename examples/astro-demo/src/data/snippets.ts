/**
 * Short code samples shared by several pages. They are documentation, kept
 * deliberately small; the live behavior lives in the capabilities suite.
 */

export const astroEmbedded = `<template flowview={context} is:raw>
  @if (context.user) {
    <h1>Hello {{ context.user.name }}</h1>
  }
</template>`;

export const astroConfig = `// astro.config.mjs
import { defineConfig } from "astro/config";
import flowview from "@flowview/astro";

export default defineConfig({
  integrations: [flowview()],
});`;

export const astroEventsConfig = `// astro.config.mjs
import { defineConfig } from "astro/config";
import flowview from "@flowview/astro";
import flowviewEvents from "@flowview/astro-events";

export default defineConfig({
  integrations: [flowviewEvents(), flowview()],
});`;

export const viteConfig = `// vite.config.ts
import { defineConfig } from "vite";
import flowview from "@flowview/vite";

export default defineConfig({
  plugins: [flowview()],
});`;

export const viteEventsConfig = `// vite.config.ts
import { defineConfig } from "vite";
import flowview from "@flowview/vite";
import flowviewEvents from "@flowview/vite-events";

export default defineConfig({
  // Events must run before the HTML compiler sees the template.
  plugins: [flowviewEvents(), flowview()],
});`;

export const honoRoute = `import { render } from "./users.flow";

app.get("/users", async (c) => {
  return c.html(render({ users: await getUsers() }));
});`;

export const workersRoute = `import { render } from "./page.flow";

export default {
  async fetch() {
    return new Response(render({ title: "Hello" }), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};`;

export const flowTypes = `// tsconfig.json
{ "compilerOptions": { "types": ["@flowview/vite/client"] } }`;

export const rustStatic = `use flowview_compiler::{compile_static, StaticCompileOptions};

let template = compile_static(source, StaticCompileOptions::default())?;

for page in &pages {
    let context = serde_json::to_value(page)?;
    let html = template.render(&context)?;
    // write html ...
}`;

export const rustInstall = `# Not yet published on crates.io; depend on the Git repository.
cargo add --git https://github.com/Andersseen/flowview flowview-compiler
cargo add serde_json`;

export const domView = `import { createView } from "@flowview/dom";
import { render } from "./items.flow";

const view = createView("#app", render);

view.render({ items: [] });

const summary = view.ref<HTMLParagraphElement>("summary");
const items = view.refs<HTMLLIElement>("item");
view.update({ items: [{ id: 1, name: "Ship it" }] });
const currentItems = view.refs<HTMLLIElement>("item");
// Earlier Element handles may now be detached.`;

export const reactiveStandalone = `import { signal, computed, effect, untracked } from "@flowview/reactive";

const count = signal(1);
const double = computed(() => count() * 2);

effect(() => console.log(double())); // logs 2
count.set(2);                        // logs 4

// Read without subscribing the running effect or computed.
const snapshot = untracked(() => count());`;

export const reactiveCompose = `import { createView } from "@flowview/dom";
import { signal } from "@flowview/reactive";
import { render } from "./items.flow";

const state = signal({ loading: false, items: [] });
const view = createView("#app", render);

// Initial value renders immediately; later writes replace the view.
const stop = view.bind(state);

const list = view.ref<HTMLUListElement>("list");
const rows = view.refs<HTMLLIElement>("item");

// Stop only disconnects the source. Manual updates remain available.
stop();`;

export const eventsTemplate = `<button (click)="save()">Save</button>

<input (input)="search($event)" />

<select (change)="change($event)">
  <option value="a">A</option>
  <option value="b">B</option>
</select>

<form (submit)="submit($event)">
  <button>Send</button>
</form>

<button (click)="remove('item-1', $el)">Remove</button>

<script data-flowview>
  function save() {}
  function search(event) { /* event.target.value */ }
  function change(event) {}
  function submit(event) { event.preventDefault(); }
  function remove(id, element) {}
</script>`;

export const bindingsDisabled = `<button [disabled]="context.loading">Save</button>`;
export const bindingsClass = `<div [class.active]="context.selected">...</div>`;
export const bindingsAttr = `<section [attr.aria-busy]="context.loading">...</section>`;
export const bindingsInterpolated = `<a href="{{ context.profileUrl }}">Profile</a>`;

export const controlFlowIf = `@if (context.user) {
  <p>Hello {{ context.user.name }}</p>
} @else if (context.guest) {
  <p>Welcome, guest</p>
} @else {
  <p>Please sign in</p>
}`;

export const controlFlowFor = `@for (item of context.items; track item.id) {
  <li>{{ item.title }}</li>
} @empty {
  <li>Nothing here yet</li>
}`;

export const controlFlowSwitch = `@switch (context.status) {
  @case ('draft') { <span>Draft</span> }
  @case ('published') { <span>Published</span> }
  @default { <span>Unknown</span> }
}`;

export const interpolation = `<p>{{ context.title }}</p>      <!-- escaped -->
<div>{{{ context.bodyHtml }}}</div>  <!-- raw, trusted -->`;

export const compiledOutput = `import { renderValue } from "@flowview/runtime";

export function render(context) {
  let output = "";
  // ... generated from your template
  return output;
}`;
