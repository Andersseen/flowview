import { signal } from "@flowview/reactive";

export interface ClientItem {
  id: number;
  name: string;
  status: "active" | "completed";
}

export interface ClientState {
  [key: string]: unknown;
  loading: boolean;
  items: ClientItem[];
  selectedTaskId: number | null;
}

/**
 * Shared client-side state for the `client-dom` demo page. The Astro page
 * script and the compiled `<script data-flowview>` block both import this
 * same module, so a signal write from either side reaches the other without
 * `CustomEvent` plumbing or direct DOM lookups.
 */
export const clientState = signal<ClientState>({
  loading: false,
  items: [],
  selectedTaskId: null,
});

const RELOADED_ITEMS: ClientItem[] = [
  { id: 3, name: "Publish metrics", status: "completed" },
  { id: 4, name: "Triage queue", status: "active" },
];

export function reloadItems(): void {
  clientState.update((state) => ({
    ...state,
    loading: true,
    items: RELOADED_ITEMS,
  }));

  setTimeout(() => {
    clientState.update((state) => ({ ...state, loading: false }));
  }, 125);
}

export function selectTask(id: number): void {
  clientState.update((state) => ({ ...state, selectedTaskId: id }));
}
