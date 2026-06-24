import type { SyntaxExampleId, SyntaxShowcaseContext } from "./types";

const examples: {
  id: SyntaxExampleId;
  label: string;
  code: string;
  description: string;
}[] = [
  {
    id: "if",
    label: "Conditional",
    code: `@if (user.isAdmin) {
  <span>Admin</span>
} @else if (user.isMember) {
  <span>Member</span>
} @else {
  <span>Guest</span>
}`,
    description: "Branch on conditions with @if, @else if, and @else.",
  },
  {
    id: "for",
    label: "Iteration",
    code: `@for (product of products; track product.id) {
  <article>
    <h3>{{ product.name }}</h3>
    <p>{{ product.price }}</p>
  </article>
} @empty {
  <p>No products found.</p>
}`,
    description:
      "Loop over iterables with optional keyed tracking and an @empty fallback.",
  },
  {
    id: "switch",
    label: "Switch",
    code: `@switch (product.status) {
  @case ('available') {
    <span>In stock</span>
  }
  @case ('sale') {
    <span>On sale</span>
  }
  @default {
    <span>Out of stock</span>
  }
}`,
    description:
      "Match expressions against multiple cases with a fallback @default.",
  },
];

export const syntaxContext: SyntaxShowcaseContext = {
  examples,
};
