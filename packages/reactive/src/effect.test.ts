import { describe, expect, it, vi } from "vitest";
import { effect } from "./effect.js";
import { signal } from "./signal.js";

describe("effect", () => {
  it("runs immediately on creation", () => {
    const count = signal(0);
    const spy = vi.fn();

    effect(() => {
      count();
      spy();
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reruns when a dependency changes", () => {
    const count = signal(0);
    const spy = vi.fn();

    effect(() => {
      count();
      spy();
    });

    count.set(1);
    expect(spy).toHaveBeenCalledTimes(2);

    count.set(2);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("tracks multiple dependencies", () => {
    const a = signal(0);
    const b = signal(0);
    const spy = vi.fn();

    effect(() => {
      a();
      b();
      spy();
    });

    a.set(1);
    expect(spy).toHaveBeenCalledTimes(2);

    b.set(1);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("re-tracks dependencies on every run, dropping branches no longer read", () => {
    const flag = signal(true);
    const a = signal("a");
    const b = signal("b");
    const spy = vi.fn();

    effect(() => {
      flag() ? a() : b();
      spy();
    });

    a.set("a2");
    expect(spy).toHaveBeenCalledTimes(2);

    b.set("b2");
    expect(spy).toHaveBeenCalledTimes(2);

    flag.set(false);
    expect(spy).toHaveBeenCalledTimes(3);

    b.set("b3");
    expect(spy).toHaveBeenCalledTimes(4);

    a.set("a3");
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("stop() ends the effect and no longer reruns it", () => {
    const count = signal(0);
    const spy = vi.fn();

    const stop = effect(() => {
      count();
      spy();
    });

    stop();
    count.set(1);
    count.set(2);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stop() is safe to call more than once", () => {
    const count = signal(0);
    const spy = vi.fn();

    const stop = effect(() => {
      count();
      spy();
    });

    stop();
    stop();
    count.set(1);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("runs a returned cleanup before the next run and on stop", () => {
    const count = signal(0);
    const cleanup = vi.fn();

    const stop = effect(() => {
      count();
      return cleanup;
    });

    expect(cleanup).not.toHaveBeenCalled();

    count.set(1);
    expect(cleanup).toHaveBeenCalledTimes(1);

    stop();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
