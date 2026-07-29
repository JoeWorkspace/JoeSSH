// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteItem } from "./CommandPalette";

const t = ((key: string) => key) as any;

function makeItem(overrides: Partial<PaletteItem> = {}): PaletteItem {
  return { icon: null, name: "Test", kind: "connection", ...overrides };
}

afterEach(() => {
  cleanup();
});

describe("CommandPalette", () => {
  const defaultProps = {
    input: "",
    index: 0,
    items: [] as PaletteItem[],
    onInputChange: vi.fn(),
    onClose: vi.fn(),
    onIndexChange: vi.fn(),
    onKeyDown: vi.fn(),
    onSelect: vi.fn(),
    t,
  };

  it("renders with empty items list", () => {
    render(<CommandPalette {...defaultProps} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("moves focus into the combobox and restores the opener on unmount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<CommandPalette {...defaultProps} />);
    expect(document.activeElement).toBe(screen.getByRole("combobox"));

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("renders placeholder when no items", () => {
    render(<CommandPalette {...defaultProps} items={[]} />);
    expect(screen.getByText("desktop.paletteEmptyTitle")).toBeTruthy();
    expect(screen.getByText("desktop.paletteEmptyHint")).toBeTruthy();
    expect(screen.queryByText("desktop.searchPlaceholder")).toBeNull();
  });

  it("renders items with names", () => {
    const items = [makeItem({ name: "My Server" }), makeItem({ name: "Other" })];
    render(<CommandPalette {...defaultProps} items={items} />);
    expect(screen.getByText("My Server")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });

  it("marks active item with aria-selected", () => {
    const items = [makeItem({ name: "First" }), makeItem({ name: "Second" })];
    render(<CommandPalette {...defaultProps} items={items} index={1} />);
    expect(screen.getByText("First").closest('[role="option"]')?.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("Second").closest('[role="option"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("calls onInputChange when typing", () => {
    const onInputChange = vi.fn();
    render(<CommandPalette {...defaultProps} onInputChange={onInputChange} />);
    const input = screen.getByPlaceholderText("desktop.palettePlaceholder");
    fireEvent.change(input, { target: { value: "test" } });
    expect(onInputChange).toHaveBeenCalledWith("test");
  });

  it("calls onClose when clicking backdrop", () => {
    const onClose = vi.fn();
    render(<CommandPalette {...defaultProps} onClose={onClose} />);
    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSelect when clicking an item", () => {
    const onSelect = vi.fn();
    const items = [makeItem({ name: "Target" })];
    render(<CommandPalette {...defaultProps} items={items} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Target"));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("calls onIndexChange on mouse enter", () => {
    const onIndexChange = vi.fn();
    const items = [makeItem({ name: "Hover" })];
    render(<CommandPalette {...defaultProps} items={items} onIndexChange={onIndexChange} />);
    fireEvent.mouseEnter(screen.getByText("Hover").closest('[role="option"]') as HTMLElement);
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("calls onKeyDown when pressing keys", () => {
    const onKeyDown = vi.fn();
    render(<CommandPalette {...defaultProps} onKeyDown={onKeyDown} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it("shows section headers for different item kinds", () => {
    const items = [
      makeItem({ name: "Quick", kind: "quick-connect" }),
      makeItem({ name: "Recent", kind: "recent" }),
    ];
    render(<CommandPalette {...defaultProps} items={items} />);
    expect(screen.getByText("desktop.quickConnect")).toBeTruthy();
    expect(screen.getByText("desktop.paletteRecent")).toBeTruthy();
  });

  it("shows shortcut kbd when provided", () => {
    const items = [makeItem({ name: "Cmd", shortcut: "Ctrl+N" })];
    render(<CommandPalette {...defaultProps} items={items} />);
    expect(screen.getByText("Ctrl+N")).toBeTruthy();
  });

  it("shows sub text when provided", () => {
    const items = [makeItem({ name: "Server", sub: "ssh://host" })];
    render(<CommandPalette {...defaultProps} items={items} />);
    expect(screen.getByText("ssh://host")).toBeTruthy();
  });

  it("shows recent badge for recent items", () => {
    const items = [makeItem({ name: "Old", kind: "recent" })];
    render(<CommandPalette {...defaultProps} items={items} />);
    expect(screen.getByText("desktop.paletteRecentBadge")).toBeTruthy();
  });

  it("shows recent badge for recent-command items", () => {
    const items = [makeItem({ name: "Cmd", kind: "recent-command" })];
    render(<CommandPalette {...defaultProps} items={items} />);
    expect(screen.getByText("desktop.paletteRecentBadge")).toBeTruthy();
  });

  it("does not show duplicate section headers for same kind", () => {
    const items = [
      makeItem({ name: "A", kind: "connection" }),
      makeItem({ name: "B", kind: "connection" }),
    ];
    render(<CommandPalette {...defaultProps} items={items} />);
    const headers = screen.getAllByText("desktop.paletteConnections");
    expect(headers).toHaveLength(1);
  });

  it("wires combobox ARIA to the active option", () => {
    const items = [makeItem({ name: "First" }), makeItem({ name: "Second" })];
    render(<CommandPalette {...defaultProps} items={items} index={1} />);
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe("palette-listbox");
    expect(input.getAttribute("aria-activedescendant")).toBe("palette-option-1");
    const activeOption = screen.getByText("Second").closest("button");
    expect(activeOption?.id).toBe("palette-option-1");
    expect(activeOption?.tabIndex).toBe(-1);
  });

  it("collapses combobox when there are no items", () => {
    render(<CommandPalette {...defaultProps} items={[]} />);
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });
});
