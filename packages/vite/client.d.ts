declare module "*.flow" {
  export function render(context: Record<string, unknown>): string;
}
