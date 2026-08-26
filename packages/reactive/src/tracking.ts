/**
 * A node in the reactive dependency graph. Signals, computed values and
 * effects are all `ReactiveNode`s so tracking and cleanup share one shape.
 */
export interface ReactiveNode {
  version: number;
  observers: Set<ReactiveNode>;
  dependencies: Set<ReactiveNode>;
  notify(): void;
  /** Called when this node's last observer is removed, for lazy cleanup. */
  onBecomeUnobserved?: () => void;
}

let activeObserver: ReactiveNode | null = null;
let trackingDisabled = 0;

export function getActiveObserver(): ReactiveNode | null {
  return trackingDisabled > 0 ? null : activeObserver;
}

export function setActiveObserver(
  node: ReactiveNode | null,
): ReactiveNode | null {
  const previous = activeObserver;
  activeObserver = node;
  return previous;
}

/**
 * Reads performed inside `fn` do not register reactive dependencies, even
 * when called from inside a `computed()` or `effect()`.
 */
export function untracked<T>(fn: () => T): T {
  trackingDisabled++;
  try {
    return fn();
  } finally {
    trackingDisabled--;
  }
}

export function trackDependency(producer: ReactiveNode): void {
  const observer = getActiveObserver();
  if (observer !== null) {
    producer.observers.add(observer);
    observer.dependencies.add(producer);
  }
}

export function removeObserver(
  producer: ReactiveNode,
  observer: ReactiveNode,
): void {
  producer.observers.delete(observer);
  if (producer.observers.size === 0) {
    producer.onBecomeUnobserved?.();
  }
}
