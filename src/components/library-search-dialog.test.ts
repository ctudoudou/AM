import { describe, expect, it, vi } from "vitest";
import {
  resolveDialogTabTarget,
  restoreDialogTrigger,
} from "./library-search-dialog";

describe("library search dialog focus management", () => {
  it("wraps forward focus from the last control to the first control", () => {
    const first = {} as HTMLElement;
    const middle = {} as HTMLElement;
    const last = {} as HTMLElement;

    expect(resolveDialogTabTarget([first, middle, last], last, false)).toBe(first);
  });

  it("wraps backward focus from the first control to the last control", () => {
    const first = {} as HTMLElement;
    const middle = {} as HTMLElement;
    const last = {} as HTMLElement;

    expect(resolveDialogTabTarget([first, middle, last], first, true)).toBe(last);
  });

  it("leaves native tab order alone between the dialog boundaries", () => {
    const first = {} as HTMLElement;
    const middle = {} as HTMLElement;
    const last = {} as HTMLElement;

    expect(resolveDialogTabTarget([first, middle, last], middle, false)).toBeNull();
    expect(resolveDialogTabTarget([first, middle, last], middle, true)).toBeNull();
    expect(resolveDialogTabTarget([], null, false)).toBeNull();
  });

  it("recovers focus inside the dialog if it is unexpectedly outside", () => {
    const first = {} as HTMLElement;
    const last = {} as HTMLElement;
    const outside = {} as HTMLElement;

    expect(resolveDialogTabTarget([first, last], outside, false)).toBe(first);
    expect(resolveDialogTabTarget([first, last], outside, true)).toBe(last);
  });

  it("only restores focus to a trigger that is still connected", () => {
    const connectedFocus = vi.fn();
    const disconnectedFocus = vi.fn();

    expect(restoreDialogTrigger({ focus: connectedFocus, isConnected: true })).toBe(true);
    expect(restoreDialogTrigger({ focus: disconnectedFocus, isConnected: false })).toBe(false);
    expect(connectedFocus).toHaveBeenCalledOnce();
    expect(disconnectedFocus).not.toHaveBeenCalled();
  });
});
