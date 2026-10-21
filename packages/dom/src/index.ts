export type RenderFunction<TContext> = (context: TContext) => string;

/** A synchronous, current-value source such as a Flowview Signal or Computed. */
export interface FlowviewValueSource<T> {
  subscribe(callback: (value: T) => void): () => void;
}

export interface FlowviewView<TContext> {
  render(context: TContext): void;
  update(context: TContext): void;
  ref<TElement extends Element = Element>(name: string): TElement | null;
  refs<TElement extends Element = Element>(name: string): TElement[];
  bind(source: FlowviewValueSource<TContext>): () => void;
  dispose(): void;
}

interface Binding {
  stop?: () => void;
  active: boolean;
}

interface ViewState {
  readonly root: Element;
  dispose(): void;
}

const activeRoots = new WeakMap<Element, ViewState>();
const referenceAttribute = "data-flow-ref";

export function createView<TContext>(
  target: FlowviewTarget,
  renderFunction: RenderFunction<TContext>,
): FlowviewView<TContext> {
  const root = resolveTarget(target);
  if (activeRoots.has(root)) {
    throw new Error(
      "[flowview] This DOM root is already owned by an active view. Dispose the existing view before creating another one for the same element.",
    );
  }

  let disposed = false;
  let binding: Binding | undefined;

  const ensureActive = (operation: string): void => {
    if (disposed) {
      throw new Error(
        `[flowview] Cannot ${operation} a disposed view. Create a new view instead.`,
      );
    }
  };

  const stopBinding = (current: Binding): void => {
    if (!current.active) return;
    current.active = false;
    if (binding === current) binding = undefined;
    current.stop?.();
  };

  const disposeNestedViews = (): void => {
    for (const element of Array.from(root.querySelectorAll("*"))) {
      activeRoots.get(element)?.dispose();
    }
  };
  let disposeOwnedView = (): void => {};
  const state: ViewState = { root, dispose: () => disposeOwnedView() };
  activeRoots.set(root, state);

  const replace = (context: TContext): void => {
    ensureActive("render");
    const html = renderFunction(context);
    disposeNestedViews();
    root.innerHTML = html;
  };

  const ownedRefs = (name: string): Element[] => {
    const candidates: Element[] = [];
    if (root.getAttribute(referenceAttribute) === name) candidates.push(root);

    for (const element of Array.from(
      root.querySelectorAll(`[${referenceAttribute}]`),
    )) {
      if (element.getAttribute(referenceAttribute) !== name) continue;

      let ancestor = element.parentElement;
      let crossesNestedView = false;
      while (ancestor !== null && ancestor !== root) {
        if (activeRoots.has(ancestor)) {
          crossesNestedView = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (!crossesNestedView) candidates.push(element);
    }
    return candidates;
  };

  const view: FlowviewView<TContext> = {
    render: replace,
    update: replace,
    ref<TElement extends Element = Element>(name: string): TElement | null {
      ensureActive("read a reference from");
      const matches = ownedRefs(name);
      if (matches.length > 1) {
        throw new Error(
          `[flowview] Reference "${name}" matched ${matches.length} elements in this view. Use view.refs("${name}") to read all matches.`,
        );
      }
      return (matches[0] as TElement | undefined) ?? null;
    },
    refs<TElement extends Element = Element>(name: string): TElement[] {
      ensureActive("read references from");
      return ownedRefs(name) as TElement[];
    },
    bind(source: FlowviewValueSource<TContext>): () => void {
      ensureActive("bind");
      if (binding?.active) {
        throw new Error(
          "[flowview] This view already has an active binding. Stop it before binding another value source.",
        );
      }

      const current: Binding = { active: true };
      binding = current;
      try {
        const unsubscribe = source.subscribe((context) => {
          if (current.active) replace(context);
        });
        current.stop = unsubscribe;
        if (!current.active) unsubscribe();
      } catch (error) {
        current.active = false;
        if (binding === current) binding = undefined;
        current.stop?.();
        throw error;
      }

      return () => stopBinding(current);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (binding) stopBinding(binding);
      disposeNestedViews();
      if (activeRoots.get(root) === state) activeRoots.delete(root);
    },
  };

  // Store disposal on the ownership record so parent replacement can terminate
  // nested views without adding metadata to DOM nodes.
  disposeOwnedView = () => view.dispose();
  return view;
}

export type FlowviewTarget = Element | string;

function resolveTarget(target: FlowviewTarget): Element {
  if (typeof target !== "string") return target;

  if (typeof document === "undefined") {
    throw new Error(
      `[flowview] Cannot resolve target selector "${target}" without a DOM document.`,
    );
  }

  const element = document.querySelector(target);
  if (element === null) {
    throw new Error(
      `[flowview] Could not find DOM target for selector "${target}".`,
    );
  }
  return element;
}
