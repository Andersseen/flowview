export interface FlowEventHandlers {
  [name: string]: (...args: any[]) => unknown;
}

const FLOW_EVENT_PREFIX = "data-flow-on-";
const FLOW_ARGS_ATTR = "data-flow-args";
const FLOW_SCOPE_ATTR = "data-flow-scope";
const FLOW_EVENT_MARKER = "__flow";
// Elements without a `data-flow-scope` attribute resolve against this scope.
const DEFAULT_SCOPE = "";

// focus/blur do not bubble, so delegation for them must use the capture phase.
const CAPTURE_EVENTS = new Set(["focus", "blur"]);

const registry = new Map<string, FlowEventHandlers>();
const listening = new Set<string>();

/**
 * Register handlers for a compiled flowview Events scope and ensure a single
 * delegated `document` listener exists for each event name. Handlers are
 * resolved at dispatch time via `data-flow-scope` on the matched element, so
 * elements added to the DOM later (view transitions, `@for` re-renders) work
 * without rebinding.
 *
 * Returns an unbind function that removes this scope's handlers. Document
 * listeners are left attached; they are inert once the scope is gone.
 */
export function registerFlowHandlers(
  scope: string,
  handlers: FlowEventHandlers,
  events: string[],
): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  registry.set(scope, handlers);
  for (const eventName of events) {
    ensureListening(eventName);
  }

  return () => {
    registry.delete(scope);
  };
}

function ensureListening(eventName: string): void {
  if (listening.has(eventName)) return;
  listening.add(eventName);
  document.addEventListener(eventName, createDelegatedListener(eventName), {
    capture: CAPTURE_EVENTS.has(eventName),
  });
}

function createDelegatedListener(eventName: string): (event: Event) => void {
  const attribute = `${FLOW_EVENT_PREFIX}${eventName}`;

  return (event: Event) => {
    if (!(event.target instanceof Element)) return;

    const element = event.target.closest(`[${attribute}]`);
    if (element === null) return;

    const handlerName = element.getAttribute(attribute);
    if (handlerName === null) return;

    const scope = element.getAttribute(FLOW_SCOPE_ATTR) ?? DEFAULT_SCOPE;
    const handler = registry.get(scope)?.[handlerName];
    if (typeof handler !== "function") {
      console.warn(
        `[flowview] Event handler "${handlerName}" is not a function.`,
      );
      return;
    }

    const args = readArgs(element).map((arg) =>
      resolveArg(arg, event, element),
    );
    handler(...args);
  };
}

function readArgs(element: Element): unknown[] {
  const raw = element.getAttribute(FLOW_ARGS_ATTR);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`[flowview] Could not parse event args: ${raw}`);
    return [];
  }
}

function resolveArg(arg: unknown, event: Event, element: Element): unknown {
  if (isFlowviewMarker(arg, "$event")) return event;
  if (isFlowviewMarker(arg, "$el")) return element;
  return arg;
}

function isFlowviewMarker(arg: unknown, marker: string): boolean {
  return (
    typeof arg === "object" &&
    arg !== null &&
    FLOW_EVENT_MARKER in arg &&
    (arg as Record<string, unknown>)[FLOW_EVENT_MARKER] === marker
  );
}
