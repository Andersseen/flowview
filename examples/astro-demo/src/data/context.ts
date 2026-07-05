export const demoContext = {
  store: {
    name: "flowview Gear",
    currency: "$",
  },
  title: "Inventory Dashboard",
  description:
    "A server-rendered product catalog built with flowview control flow inside Astro.",
  products: [
    {
      id: 1,
      name: "Ergonomic Keyboard",
      description: "A comfortable keyboard for long coding sessions.",
      status: "available",
      price: 129,
      category: "Peripherals",
      stock: 12,
    },
    {
      id: 2,
      name: "Wireless Mouse",
      description: "Precision mouse with a long battery life.",
      status: "sale",
      price: 59,
      category: "Peripherals",
      stock: 4,
    },
    {
      id: 3,
      name: "Mechanical Keycaps",
      description: "Custom keycaps for your favorite switches.",
      status: "unavailable",
      price: 39,
      category: "Accessories",
      stock: 0,
    },
    {
      id: 4,
      name: "USB-C Dock",
      description: "Expand your laptop with 6 ports.",
      status: "available",
      price: 89,
      category: "Accessories",
      stock: 7,
    },
  ],
  notes: [
    {
      title: "Template source is trusted code",
      body: "Expressions are emitted as JavaScript. Context values are escaped when interpolated.",
    },
    {
      title: "Whitespace is preserved",
      body: "Text around completed control-flow blocks keeps its original spacing and line breaks.",
    },
    {
      title: "JavaScript-aware boundaries",
      body: "Nested template literals, comments, regular expressions, and object literals can appear inside expressions.",
    },
  ],
};
