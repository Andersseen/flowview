import { describe, expect, it, vi } from "vitest";
import { computed } from "./computed.js";
import { effect } from "./effect.js";
import { signal } from "./signal.js";
import { untracked } from "./tracking.js";

describe("untracked", () => {
  it("does not register a dependency for reads inside it", () => {
    const count = signal(0);
    const spy = vi.fn();

    effect(() => {
      untracked(() => count());
      spy();
    });

    count.set(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("still returns the value read inside it", () => {
    const count = signal(42);
    expect(untracked(() => count())).toBe(42);
  });

  it("suspends tracking for the duration of a nested effect run", () => {
    const tracked = signal(0);
    const ignored = signal(0);
    const spy = vi.fn();

    effect(() => {
      tracked();
      untracked(() => ignored());
      spy();
    });

    ignored.set(1);
    expect(spy).toHaveBeenCalledTimes(1);

    tracked.set(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("suspends tracking inside a computed", () => {
    const tracked = signal(1);
    const ignored = signal(1);
    const spy = vi.fn();

    const value = computed(() => {
      spy();
      return tracked() + untracked(() => ignored());
    });

    expect(value()).toBe(2);

    ignored.set(100);
    expect(value()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);

    tracked.set(2);
    expect(value()).toBe(102);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
