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
    expect(screen.getByText("Click me")).toBeTruthy();
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

    render(<SegmentedControl options={options} value="x" onChange={onChange} />);

    expect(screen.getByText("X").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Y").getAttribute("aria-selected")).toBe("false");
  });

  it("renders Panel with ref forwarding", () => {
    const ref = { current: null };
    render(<Panel ref={ref}>Panel content</Panel>);
    expect(screen.getByText("Panel content")).toBeTruthy();
    expect(ref.current).toBeTruthy();
  });
});
