import { describe, expect, it, vi } from "vitest";
import { effect } from "./effect.js";
import { signal } from "./signal.js";

describe("signal", () => {
  it("reads the initial value", () => {
    const count = signal(0);
    expect(count()).toBe(0);
  });

  it("updates with set()", () => {
    const count = signal(0);
    count.set(5);
    expect(count()).toBe(5);
  });

  it("updates with update()", () => {
    const count = signal(10);
    count.update((value) => value * 2);
    expect(count()).toBe(20);
  });

  it("peek() reads the current value without tracking a dependency", () => {
    const count = signal(0);
    const other = signal(0);
    const spy = vi.fn();

    effect(() => {
      other();
      count.peek();
      spy();
    });

    count.set(99);
    expect(spy).toHaveBeenCalledTimes(1);

    other.set(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("notifies subscribers on change", () => {
    const count = signal(0);
    const spy = vi.fn();
    count.subscribe(spy);

    count.set(1);
    expect(spy).toHaveBeenLastCalledWith(1);
  });

  it("calls a new subscriber immediately with the current value", () => {
    const count = signal(7);
    const spy = vi.fn();
    count.subscribe(spy);

    expect(spy).toHaveBeenCalledWith(7);
  });

  it("supports multiple independent subscribers", () => {
    const count = signal(0);
    const first = vi.fn();
    const second = vi.fn();

    count.subscribe(first);
    count.subscribe(second);
    count.set(1);

    expect(first).toHaveBeenLastCalledWith(1);
    expect(second).toHaveBeenLastCalledWith(1);
  });

  it("stops notifying after unsubscribe", () => {
    const count = signal(0);
    const spy = vi.fn();
    const unsubscribe = count.subscribe(spy);

    unsubscribe();
    count.set(99);

    const callCountAfterUnsubscribe = spy.mock.calls.length;
    count.set(100);
    expect(spy.mock.calls.length).toBe(callCountAfterUnsubscribe);
  });

  it("ignores a same-value write instead of warning or notifying", () => {
    const count = signal(1);
    const spy = vi.fn();
    count.subscribe(spy);
    const callCountAfterSubscribe = spy.mock.calls.length;

    count.set(1);

    expect(spy.mock.calls.length).toBe(callCountAfterSubscribe);
  });

  it("supports a custom equality function", () => {
    const point = signal({ x: 0, y: 0 }, (a, b) => a.x === b.x && a.y === b.y);
    const spy = vi.fn();
    point.subscribe(spy);
    const callCountAfterSubscribe = spy.mock.calls.length;

    point.set({ x: 0, y: 0 });
    expect(spy.mock.calls.length).toBe(callCountAfterSubscribe);

    point.set({ x: 1, y: 0 });
    expect(spy).toHaveBeenLastCalledWith({ x: 1, y: 0 });
  });

  it("does not leak subscribers across signals", () => {
    const a = signal(0);
    const b = signal(0);
    const spy = vi.fn();

    a.subscribe(spy);
    const callCountAfterSubscribe = spy.mock.calls.length;
    b.set(1);

    expect(spy.mock.calls.length).toBe(callCountAfterSubscribe);
  });
});
