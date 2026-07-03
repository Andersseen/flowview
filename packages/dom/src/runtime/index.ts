export interface FlowEventHandlers {
  [name: string]: (...args: any[]) => unknown;
}

const FLOW_EVENT_PREFIX = "data-flow-on-";
const FLOW_ARGS_ATTR = "data-flow-args";
const FLOW_EVENT_MARKER = "__flow";
const FLOW_BOUND_ATTR = "data-flow-bound";

/**
 * Scan the document for Flowmark Events markers and attach native listeners.
 */
export function bindFlowEvents(handlers: FlowEventHandlers): void {
  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => bindFlowEventsNow(document, handlers),
      { once: true },
    );
    return;
  }

  bindFlowEventsNow(document, handlers);
}

function bindFlowEventsNow(
  root: ParentNode,
  handlers: FlowEventHandlers,
): void {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (
      Array.from((element as HTMLElement).attributes).some((attribute) =>
        attribute.name.startsWith(FLOW_EVENT_PREFIX),
      )
    ) {
      bindElement(element as HTMLElement, handlers);
    }
  }
}

function bindElement(element: HTMLElement, handlers: FlowEventHandlers): void {
  if (element.hasAttribute(FLOW_BOUND_ATTR)) return;

  for (const attribute of Array.from(element.attributes)) {
    if (!attribute.name.startsWith(FLOW_EVENT_PREFIX)) continue;

    const eventName = attribute.name.slice(FLOW_EVENT_PREFIX.length);
    const handlerName = attribute.value;
    const handler = handlers[handlerName];
    if (typeof handler !== "function") {
      console.warn(
        `[flowmark] Event handler "${handlerName}" is not a function.`,
      );
      continue;
    }

    const args = readArgs(element);
    element.addEventListener(eventName, (event: Event) => {
      const resolvedArgs = args.map((arg) => resolveArg(arg, event, element));
      handler(...resolvedArgs);
    });
  }

  element.setAttribute(FLOW_BOUND_ATTR, "true");
}

function readArgs(element: HTMLElement): unknown[] {
  const raw = element.getAttribute(FLOW_ARGS_ATTR);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`[flowmark] Could not parse event args: ${raw}`);
    return [];
  }
}

function resolveArg(arg: unknown, event: Event, element: HTMLElement): unknown {
  if (isFlowMarker(arg, "$event")) return event;
  if (isFlowMarker(arg, "$el")) return element;
  return arg;
}

function isFlowMarker(arg: unknown, marker: string): boolean {
  return (
    typeof arg === "object" &&
    arg !== null &&
    FLOW_EVENT_MARKER in arg &&
    (arg as Record<string, unknown>)[FLOW_EVENT_MARKER] === marker
  );
}

/**
 * Bind events scoped to a specific root element. Useful for partial updates.
 */
export function bindFlowEventsIn(
  root: ParentNode,
  handlers: FlowEventHandlers,
): void {
  if (typeof document === "undefined") return;
  bindFlowEventsNow(root, handlers);
}
