// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

const { mockGetActiveElement } = vi.hoisted(() => ({
  mockGetActiveElement: vi.fn(() => document.activeElement as HTMLElement | null),
}));

vi.mock("./dom-utils", () => ({
  getActiveElement: mockGetActiveElement,
}));

describe("useFocusTrap", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockGetActiveElement.mockReset();
    mockGetActiveElement.mockImplementation(() => document.activeElement as HTMLElement | null);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it("exports a function", () => {
    expect(typeof useFocusTrap).toBe("function");
  });

  it("returns a ref object", () => {
    const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(false));
    expect(result.current).toHaveProperty("current");
  });

  it("ref is null when no element is attached", () => {
    const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(false));
    expect(result.current.current).toBeNull();
  });

  it("does not throw when active with no element", () => {
    expect(() => {
      renderHook(() => useFocusTrap<HTMLDivElement>(true));
    }).not.toThrow();
  });

  it("focuses the first focusable element when activated", () => {
    const button1 = document.createElement("button");
    button1.textContent = "First";
    const button2 = document.createElement("button");
    button2.textContent = "Second";
    container.appendChild(button1);
    container.appendChild(button2);

    const focusSpy = vi.spyOn(button1, "focus");

    renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    expect(focusSpy).toHaveBeenCalled();
  });

  it("restores focus to previous element on cleanup", () => {
    const previousElement = document.createElement("button");
    document.body.appendChild(previousElement);

    const button = document.createElement("button");
    container.appendChild(button);

    mockGetActiveElement.mockReturnValue(previousElement);

    const { unmount } = renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    unmount();

    document.body.removeChild(previousElement);
  });

  it("traps Tab key at the end of focusable elements", () => {
    const button1 = document.createElement("button");
    const button2 = document.createElement("button");
    container.appendChild(button1);
    container.appendChild(button2);

    renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    mockGetActiveElement.mockReturnValue(button2);

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, "preventDefault");
    container.dispatchEvent(tabEvent);

    expect(preventSpy).toHaveBeenCalled();
  });

  it("traps Shift+Tab at the beginning of focusable elements", () => {
    const button1 = document.createElement("button");
    const button2 = document.createElement("button");
    container.appendChild(button1);
    container.appendChild(button2);

    renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    mockGetActiveElement.mockReturnValue(button1);

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, "preventDefault");
    container.dispatchEvent(tabEvent);

    expect(preventSpy).toHaveBeenCalled();
  });

  it("does not prevent Tab when not at boundary", () => {
    const button1 = document.createElement("button");
    const button2 = document.createElement("button");
    const button3 = document.createElement("button");
    container.appendChild(button1);
    container.appendChild(button2);
    container.appendChild(button3);

    renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    mockGetActiveElement.mockReturnValue(button2);

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, "preventDefault");
    container.dispatchEvent(tabEvent);

    expect(preventSpy).not.toHaveBeenCalled();
  });

  it("ignores non-Tab keys", () => {
    const button = document.createElement("button");
    container.appendChild(button);

    renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    button.focus();
    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    const preventSpy = vi.spyOn(enterEvent, "preventDefault");
    container.dispatchEvent(enterEvent);

    expect(preventSpy).not.toHaveBeenCalled();
  });

  it("does nothing when inactive", () => {
    const button = document.createElement("button");
    container.appendChild(button);
    const addSpy = vi.spyOn(container, "addEventListener");

    renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(false);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    const keydownCalls = addSpy.mock.calls.filter((c) => c[0] === "keydown");
    expect(keydownCalls).toHaveLength(0);
  });

  it("handles container with no focusable elements", () => {
    const div = document.createElement("div");
    container.appendChild(div);

    expect(() => {
      renderHook(() => {
        const ref = useFocusTrap<HTMLDivElement>(true);
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
        return ref;
      });
    }).not.toThrow();
  });

  it("does not prevent Tab when container has no focusable elements", () => {
    const div = document.createElement("div");
    container.appendChild(div);

    renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, "preventDefault");
    container.dispatchEvent(tabEvent);

    expect(preventSpy).not.toHaveBeenCalled();
  });

  it("traps Shift+Tab at first element (moves to last)", () => {
    const button1 = document.createElement("button");
    const button2 = document.createElement("button");
    container.appendChild(button1);
    container.appendChild(button2);

    renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    mockGetActiveElement.mockReturnValue(button1);

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, "preventDefault");
    container.dispatchEvent(tabEvent);

    expect(preventSpy).toHaveBeenCalled();
  });

  it("does not trap Shift+Tab when not at first element", () => {
    const button1 = document.createElement("button");
    const button2 = document.createElement("button");
    container.appendChild(button1);
    container.appendChild(button2);

    renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    mockGetActiveElement.mockReturnValue(button2);

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, "preventDefault");
    container.dispatchEvent(tabEvent);

    expect(preventSpy).not.toHaveBeenCalled();
  });

  it("cleans up event listener on unmount", () => {
    const button = document.createElement("button");
    container.appendChild(button);
    const removeSpy = vi.spyOn(container, "removeEventListener");

    const { unmount } = renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    unmount();

    const keydownRemovals = removeSpy.mock.calls.filter((c) => c[0] === "keydown");
    expect(keydownRemovals).toHaveLength(1);
  });

  it("does not throw on cleanup when no previous element was focused", () => {
    const button = document.createElement("button");
    container.appendChild(button);

    mockGetActiveElement.mockReturnValue(null);

    const { unmount } = renderHook(() => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container;
      return ref;
    });

    expect(() => unmount()).not.toThrow();
  });
});
