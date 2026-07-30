// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, Badge, IconButton, SegmentedControl, Panel } from "./primitives";

afterEach(() => {
  cleanup();
});

describe("design-system primitives", () => {
  it("renders Button with default variant", () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole("button", { name: "Click me" });
    expect(button).toBeTruthy();
    expect(button.getAttribute("type")).toBe("button");
  });

  it("allows an explicit submit type without making it the primitive default", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" }).getAttribute("type")).toBe("submit");
  });

  it("renders Button with ghost variant", () => {
    render(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByText("Ghost")).toBeTruthy();
  });

  it("renders Button with danger variant", () => {
    render(<Button variant="danger">Danger</Button>);
    expect(screen.getByText("Danger")).toBeTruthy();
  });

  it("renders Button with sm size", () => {
    render(<Button size="sm">Small</Button>);
    expect(screen.getByText("Small")).toBeTruthy();
  });

  it("renders Button with icon size", () => {
    render(<Button size="icon">Icon</Button>);
    expect(screen.getByText("Icon")).toBeTruthy();
  });

  it("renders Badge with neutral tone", () => {
    render(<Badge>Neutral</Badge>);
    expect(screen.getByText("Neutral")).toBeTruthy();
  });

  it("renders Badge with good tone", () => {
    render(<Badge tone="good">Active</Badge>);
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("renders Badge with warn tone", () => {
    render(<Badge tone="warn">Warning</Badge>);
    expect(screen.getByText("Warning")).toBeTruthy();
  });

  it("renders Badge with premium tone", () => {
    render(<Badge tone="premium">Pro</Badge>);
    expect(screen.getByText("Pro")).toBeTruthy();
  });

  it("renders IconButton with aria-label", () => {
    render(<IconButton label="Settings">⚙</IconButton>);
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("keeps the required accessible name when passthrough props conflict", () => {
    render(
      <IconButton aria-label="Wrong label" label="Settings">
        ⚙
      </IconButton>,
    );

    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Wrong label" })).toBeNull();
  });

  it("renders SegmentedControl with options and handles clicks", () => {
    const onChange = vi.fn();
    const options = [
      { value: "a" as const, label: "Option A" },
      { value: "b" as const, label: "Option B" },
    ];

    render(<SegmentedControl options={options} value="a" onChange={onChange} label="test-control" />);

    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByText("Option A")).toBeTruthy();
    expect(screen.getByText("Option B")).toBeTruthy();

    fireEvent.click(screen.getByText("Option B"));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("renders SegmentedControl with aria-selected", () => {
    const onChange = vi.fn();
    const options = [
      { value: "x" as const, label: "X" },
      { value: "y" as const, label: "Y" },
    ];

    render(<SegmentedControl label="Coordinate plane" options={options} value="x" onChange={onChange} />);

    expect(screen.getByText("X").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Y").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("X").getAttribute("tabindex")).toBe("0");
    expect(screen.getByText("Y").getAttribute("tabindex")).toBe("-1");
  });

  it("supports roving keyboard focus and automatic selection", () => {
    const onChange = vi.fn();
    const options = [
      { value: "a" as const, label: "Option A" },
      { value: "b" as const, label: "Option B" },
      { value: "c" as const, label: "Option C" },
    ];

    render(<SegmentedControl label="Panel" options={options} value="a" onChange={onChange} />);

    const first = screen.getByRole("tab", { name: "Option A" });
    const second = screen.getByRole("tab", { name: "Option B" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });

    expect(onChange).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Option C" }));

    fireEvent.keyDown(screen.getByRole("tab", { name: "Option C" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(first);
  });

  it("supports every standard tablist navigation key and ignores unrelated keys", () => {
    const onChange = vi.fn();
    const options = [
      { value: "a" as const, label: "Option A" },
      { value: "b" as const, label: "Option B" },
      { value: "c" as const, label: "Option C" },
    ];

    render(
      <SegmentedControl
        label="Panel"
        options={options}
        value={"missing" as "a"}
        onChange={onChange}
      />,
    );

    const first = screen.getByRole("tab", { name: "Option A" });
    const second = screen.getByRole("tab", { name: "Option B" });
    expect(first.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Option C" }),
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "Option C" }), {
      key: "Home",
    });
    expect(onChange).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(first);

    const callCount = onChange.mock.calls.length;
    fireEvent.keyDown(first, { key: "PageDown" });
    expect(onChange).toHaveBeenCalledTimes(callCount);
  });

  it("renders Panel with ref forwarding", () => {
    const ref = { current: null };
    render(<Panel ref={ref}>Panel content</Panel>);
    expect(screen.getByText("Panel content")).toBeTruthy();
    expect(ref.current).toBeTruthy();
  });
});
