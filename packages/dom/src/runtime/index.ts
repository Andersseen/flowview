export interface FlowEventHandlers {
  [name: string]: (...args: any[]) => unknown;
}

const FLOW_EVENT_PREFIX = "data-flow-on-";
const FLOW_ARGS_ATTR = "data-flow-args";
const FLOW_EVENT_MARKER = "__flow";
const FLOW_BOUND_ATTR = "data-flow-bound";

/**
 * Scan the document for Flowmark Events markers and attach native listeners.
 * Returns an `unbind` function that removes the attached listeners.
 */
export function bindFlowEvents(handlers: FlowEventHandlers): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  if (document.readyState === "loading") {
    let unbind: (() => void) | undefined;
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        unbind = bindFlowEventsNow(document, handlers);
      },
      { once: true },
    );
    return () => {
      unbind?.();
    };
  }

  return bindFlowEventsNow(document, handlers);
}

function bindFlowEventsNow(
  root: ParentNode,
  handlers: FlowEventHandlers,
): () => void {
  const unbinders: (() => void)[] = [];

  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (hasFlowEventAttribute(element as HTMLElement)) {
      unbinders.push(bindElement(element as HTMLElement, handlers));
    }
  }

  return () => {
    for (const unbind of unbinders) {
      unbind();
    }
  };
}

function hasFlowEventAttribute(element: HTMLElement): boolean {
  return Array.from(element.attributes).some((attribute) =>
    attribute.name.startsWith(FLOW_EVENT_PREFIX),
  );
}

function bindElement(
  element: HTMLElement,
  handlers: FlowEventHandlers,
): () => void {
  if (element.hasAttribute(FLOW_BOUND_ATTR)) {
    return () => {};
  }

  const listeners: { eventName: string; listener: EventListener }[] = [];

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
    const listener = (event: Event) => {
      const resolvedArgs = args.map((arg) => resolveArg(arg, event, element));
      handler(...resolvedArgs);
    };
    element.addEventListener(eventName, listener);
    listeners.push({ eventName, listener });
  }

  element.setAttribute(FLOW_BOUND_ATTR, "true");

  return () => {
    for (const { eventName, listener } of listeners) {
      element.removeEventListener(eventName, listener);
    }
    element.removeAttribute(FLOW_BOUND_ATTR);
  };
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
 * Returns an `unbind` function that removes the attached listeners.
 */
export function bindFlowEventsIn(
  root: ParentNode,
  handlers: FlowEventHandlers,
): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  return bindFlowEventsNow(root, handlers);
}
