export type RenderFunction<TContext> = (context: TContext) => string;

export interface FlowviewView<TContext> {
  render(context: TContext): void;
  update(context: TContext): void;
}

export type FlowviewTarget = Element | string;

export function createView<TContext>(
  target: FlowviewTarget,
  renderFunction: RenderFunction<TContext>,
): FlowviewView<TContext> {
  const element = resolveTarget(target);

  const renderIntoTarget = (context: TContext): void => {
    element.innerHTML = renderFunction(context);
  };

  return {
    render: renderIntoTarget,
    update: renderIntoTarget,
  };
}

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
