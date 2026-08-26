import {
  type ReactiveNode,
  removeObserver,
  setActiveObserver,
  trackDependency,
  untracked,
} from "./tracking.js";

export interface Computed<T> {
  /** Reads the computed value, tracking a dependency in a reactive context. */
  (): T;
  /** Reads the computed value without tracking a dependency. */
  peek(): T;
  /** Calls `fn` with the current value, then again on every change. Returns an unsubscribe function. */
  subscribe(fn: (value: T) => void): () => void;
}

/**
 * Creates a derived, read-only reactive value. `fn` reruns lazily — only when
 * read after a dependency has changed — and its dependencies are re-tracked
 * on every recompute, so branches that stop being read stop being tracked.
 */
export function computed<T>(fn: () => T): Computed<T> {
  let value: T;
  let dirty = true;

  const dependencyVersions = new Map<ReactiveNode, number>();
  const observers = new Set<ReactiveNode>();
  const dependencies = new Set<ReactiveNode>();

  const node: ReactiveNode = {
    version: 0,
    observers,
    dependencies,
    notify: () => {
      if (dirty) return;
      dirty = true;
      node.version++;
      for (const observer of [...observers]) {
        observer.notify();
      }
    },
    onBecomeUnobserved: () => {
      for (const dependency of dependencies) {
        removeObserver(dependency, node);
      }
      dependencies.clear();
      dependencyVersions.clear();
      dirty = true;
    },
  };

  const shouldRecompute = (): boolean => {
    if (!dirty) return false;
    if (dependencyVersions.size === 0) return true;

    for (const [dependency, lastVersion] of dependencyVersions) {
      if (dependency.version !== lastVersion) return true;
    }

    dirty = false;
    return false;
  };

  const recompute = (): void => {
    for (const dependency of dependencies) removeObserver(dependency, node);
    dependencies.clear();
    dependencyVersions.clear();

    const previousObserver = setActiveObserver(node);
    try {
      value = fn();
      for (const dependency of dependencies) {
        dependencyVersions.set(dependency, dependency.version);
      }
      dirty = false;
    } finally {
      setActiveObserver(previousObserver);
    }
  };

  const read = (): T => {
    trackDependency(node);
    if (shouldRecompute()) recompute();
    return value;
  };

  read.peek = (): T => {
    if (shouldRecompute()) recompute();
    return value;
  };

  read.subscribe = (fn: (value: T) => void) => {
    let lastValue: T;

    const observer: ReactiveNode = {
      version: -1,
      observers: new Set(),
      dependencies: new Set(),
      notify: () => {
        const newValue = read();
        if (Object.is(lastValue, newValue)) return;
        lastValue = newValue;
        untracked(() => fn(newValue));
      },
    };

    observers.add(observer);
    lastValue = read();
    untracked(() => fn(lastValue));

    return () => removeObserver(node, observer);
  };

  return read as Computed<T>;
}
