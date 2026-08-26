import {
  type ReactiveNode,
  removeObserver,
  trackDependency,
  untracked,
} from "./tracking.js";

export interface Signal<T> extends ReactiveNode {
  /** Reads the current value, tracking a dependency in a reactive context. */
  (): T;
  /** Reads the current value without tracking a dependency. */
  peek(): T;
  /** Sets a new value. Ignored when `equal` considers it unchanged. */
  set(value: T): void;
  /** Sets a new value derived from the previous one. */
  update(fn: (previous: T) => T): void;
  /** Calls `fn` with the current value, then again on every change. Returns an unsubscribe function. */
  subscribe(fn: (value: T) => void): () => void;
}

/**
 * Creates a signal: a readable, writable reactive value.
 *
 * @param initial - The starting value.
 * @param equal - Equality check used to skip no-op writes. Defaults to `Object.is`.
 */
export function signal<T>(
  initial: T,
  equal: (a: T, b: T) => boolean = Object.is,
): Signal<T> {
  let value = initial;
  const observers = new Set<ReactiveNode>();

  const node = (() => {
    trackDependency(node);
    return value;
  }) as Signal<T>;

  node.version = 0;
  node.observers = observers;
  node.dependencies = new Set();
  node.notify = () => {};

  node.peek = () => value;

  node.set = (newValue: T) => {
    if (equal(value, newValue)) return;

    value = newValue;
    node.version++;

    for (const observer of [...observers]) {
      observer.notify();
    }
  };

  node.update = (fn: (previous: T) => T) => node.set(fn(value));

  node.subscribe = (fn: (value: T) => void) => {
    let lastValue = value;

    const observer: ReactiveNode = {
      version: -1,
      observers: new Set(),
      dependencies: new Set(),
      notify: () => {
        const newValue = node.peek();
        if (equal(lastValue, newValue)) return;
        lastValue = newValue;
        untracked(() => fn(newValue));
      },
    };

    observers.add(observer);
    untracked(() => fn(value));

    return () => removeObserver(node, observer);
  };

  return node;
}
