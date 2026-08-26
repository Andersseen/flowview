import {
  type ReactiveNode,
  removeObserver,
  setActiveObserver,
} from "./tracking.js";

export type EffectCleanup = () => void;
export type EffectCallback = () => void | EffectCleanup;

/**
 * Runs `fn` immediately, then again whenever a signal or computed value it
 * read last time changes. Dependencies are re-tracked on every run, so
 * branches `fn` stops reading stop triggering reruns.
 *
 * `fn` may return a cleanup function, run before the next rerun and after
 * `stop()` is called.
 *
 * @returns A `stop` function that ends the effect and runs its last cleanup.
 */
export function effect(fn: EffectCallback): () => void {
  const dependencies = new Set<ReactiveNode>();
  let cleanup: EffectCleanup | undefined;
  let disposed = false;

  const node: ReactiveNode = {
    version: 0,
    observers: new Set(),
    dependencies,
    notify: () => {
      if (!disposed) run();
    },
  };

  const cleanupDependencies = (): void => {
    for (const dependency of dependencies) removeObserver(dependency, node);
    dependencies.clear();
  };

  const runCleanup = (): void => {
    if (cleanup === undefined) return;
    const fn = cleanup;
    cleanup = undefined;
    fn();
  };

  function run(): void {
    runCleanup();
    cleanupDependencies();

    const previousObserver = setActiveObserver(node);
    try {
      cleanup = fn() ?? undefined;
    } finally {
      setActiveObserver(previousObserver);
    }
  }

  run();

  return function stop(): void {
    if (disposed) return;
    disposed = true;
    runCleanup();
    cleanupDependencies();
  };
}
