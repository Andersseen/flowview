import { describe, expect, it, vi } from "vitest";
import { computed } from "./computed.js";
import { effect } from "./effect.js";
import { signal } from "./signal.js";

describe("computed", () => {
  it("computes an initial value from a single dependency", () => {
    const count = signal(2);
    const doubled = computed(() => count() * 2);
    expect(doubled()).toBe(4);
  });

  it("recomputes when its dependency changes", () => {
    const count = signal(1);
    const doubled = computed(() => count() * 2);

    expect(doubled()).toBe(2);
    count.set(3);
    expect(doubled()).toBe(6);
  });

  it("tracks multiple dependencies", () => {
    const a = signal(1);
    const b = signal(2);
    const sum = computed(() => a() + b());

    expect(sum()).toBe(3);
    a.set(10);
    expect(sum()).toBe(12);
    b.set(20);
    expect(sum()).toBe(30);
  });

  it("supports computed values built from other computed values", () => {
    const count = signal(2);
    const doubled = computed(() => count() * 2);
    const quadrupled = computed(() => doubled() * 2);

    expect(quadrupled()).toBe(8);
    count.set(3);
    expect(quadrupled()).toBe(12);
  });

  it("caches the value and does not recompute when nothing changed", () => {
    const count = signal(0);
    const spy = vi.fn(() => count() * 2);
    const doubled = computed(spy);

    expect(doubled()).toBe(0);
    expect(doubled()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);

    count.set(1);
    expect(doubled()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("switches dependencies dynamically and stops tracking the unused branch", () => {
    const useA = signal(true);
    const a = signal(1);
    const b = signal(2);
    const value = computed(() => (useA() ? a() : b()));

    expect(value()).toBe(1);

    useA.set(false);
    expect(value()).toBe(2);

    a.set(999);
    expect(value()).toBe(2);

    b.set(3);
    expect(value()).toBe(3);
  });

  it("notifies subscribers only when the computed value changes", () => {
    const count = signal(5);
    const isPositive = computed(() => count() > 0);
    const spy = vi.fn();
    isPositive.subscribe(spy);
    const callCountAfterSubscribe = spy.mock.calls.length;

    count.set(10);
    expect(spy.mock.calls.length).toBe(callCountAfterSubscribe);

    count.set(-1);
    expect(spy).toHaveBeenLastCalledWith(false);
  });

  it("stops notifying after unsubscribe", () => {
    const count = signal(0);
    const doubled = computed(() => count() * 2);
    const spy = vi.fn();
    const unsubscribe = doubled.subscribe(spy);
    const callCountAfterSubscribe = spy.mock.calls.length;

    unsubscribe();
    count.set(10);

    expect(spy.mock.calls.length).toBe(callCountAfterSubscribe);
  });

  it("peek() reads the value without tracking a dependency", () => {
    const count = signal(0);
    const doubled = computed(() => count() * 2);
    const other = signal(0);
    const spy = vi.fn();

    effect(() => {
      other();
      doubled.peek();
      spy();
    });

    count.set(5);
    expect(spy).toHaveBeenCalledTimes(1);

    other.set(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("stops tracking its dependencies once it has no observers left", () => {
    const count = signal(0);
    const spy = vi.fn(() => count() * 2);
    const doubled = computed(spy);

    expect(doubled()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);

    const stop = effect(() => {
      doubled();
    });
    expect(spy).toHaveBeenCalledTimes(1);

    count.set(1);
    expect(spy).toHaveBeenCalledTimes(2);

    stop();
    count.set(2);
    expect(spy).toHaveBeenCalledTimes(2);

    expect(doubled()).toBe(4);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
