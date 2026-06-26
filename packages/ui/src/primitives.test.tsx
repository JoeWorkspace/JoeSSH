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

  it("defaults Button to non-submit behavior", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" }).getAttribute("type")).toBe("button");
  });

  it("allows Button submit type when explicitly requested", () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("type")).toBe("submit");
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

    expect(screen.getByRole("tab", { name: "X" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Y" }).getAttribute("aria-selected")).toBe("false");
  });

  it("supports SegmentedControl keyboard navigation", () => {
    const onChange = vi.fn();
    const options = [
      { value: "alpha" as const, label: "Alpha" },
      { value: "beta" as const, label: "Beta" },
      { value: "gamma" as const, label: "Gamma" },
    ];

    const { rerender } = render(
      <SegmentedControl options={options} value="alpha" onChange={onChange} label="sections" />,
    );

    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Alpha" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("beta");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Beta" }));

    rerender(<SegmentedControl options={options} value="beta" onChange={onChange} label="sections" />);
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "Gamma" }).getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Beta" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("gamma");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Beta" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("alpha");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Beta" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("alpha");
  });

  it("renders SegmentedControl with short labels and full accessible names", () => {
    const onChange = vi.fn();
    const options = [
      { value: "forwarding" as const, label: "Port Forwarding", shortLabel: "Ports", icon: <span>F</span> },
      { value: "settings" as const, label: "Settings", icon: <span>S</span> },
    ];

    render(<SegmentedControl options={options} value="forwarding" onChange={onChange} label="context" />);

    expect(screen.getByRole("tab", { name: "Port Forwarding" })).toBeTruthy();
    expect(screen.getByText("Ports")).toBeTruthy();
    expect(screen.queryByText("Port Forwarding")).toBeFalsy();
    expect(screen.getByRole("tab", { name: "Port Forwarding" }).getAttribute("title")).toBe("Port Forwarding");
  });

  it("renders Panel with ref forwarding", () => {
    const ref = { current: null };
    render(<Panel ref={ref}>Panel content</Panel>);
    expect(screen.getByText("Panel content")).toBeTruthy();
    expect(ref.current).toBeTruthy();
  });
});
