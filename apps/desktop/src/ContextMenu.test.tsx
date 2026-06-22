// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

const t = ((key: string) => key) as any;

const defaultConnection = { name: "my-server", group: "Production" };

afterEach(() => {
  cleanup();
});

describe("ContextMenu", () => {
  const defaultProps = {
    allGroupNames: ["Production", "Staging", "Dev"] as readonly string[],
    connection: defaultConnection,
    moveToGroupMenu: null as string | null,
    onClose: vi.fn(),
    onMoveToGroup: vi.fn(),
    onSelect: vi.fn(),
    onToggleMoveToGroup: vi.fn(),
    position: { x: 100, y: 200 },
    t,
  };

  it("renders all menu items", () => {
    render(<ContextMenu {...defaultProps} />);
    expect(screen.getByText("desktop.contextConnect")).toBeTruthy();
    expect(screen.getByText("desktop.contextEdit")).toBeTruthy();
    expect(screen.getByText("desktop.contextDuplicate")).toBeTruthy();
    expect(screen.getByText("desktop.contextCopySsh")).toBeTruthy();
    expect(screen.getByText("desktop.contextDelete")).toBeTruthy();
    expect(screen.getByText("desktop.moveToGroup")).toBeTruthy();
  });

  it("renders at the correct position", () => {
    render(<ContextMenu {...defaultProps} />);
    const menu = screen.getByRole("menu");
    expect((menu as HTMLElement).style.left).toBe("100px");
    expect((menu as HTMLElement).style.top).toBe("200px");
  });

  it("calls onClose when clicking backdrop", () => {
    const onClose = vi.fn();
    render(<ContextMenu {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("menu").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSelect('connect') when clicking connect", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu {...defaultProps} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByText("desktop.contextConnect"));
    expect(onSelect).toHaveBeenCalledWith("connect");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSelect('test') when clicking test connection", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu {...defaultProps} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByText("desktop.contextTest"));
    expect(onSelect).toHaveBeenCalledWith("test");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSelect('edit') when clicking edit", () => {
    const onSelect = vi.fn();
    render(<ContextMenu {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("desktop.contextEdit"));
    expect(onSelect).toHaveBeenCalledWith("edit");
  });

  it("calls onSelect('duplicate') when clicking duplicate", () => {
    const onSelect = vi.fn();
    render(<ContextMenu {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("desktop.contextDuplicate"));
    expect(onSelect).toHaveBeenCalledWith("duplicate");
  });

  it("calls onSelect('copySsh') when clicking copy SSH", () => {
    const onSelect = vi.fn();
    render(<ContextMenu {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("desktop.contextCopySsh"));
    expect(onSelect).toHaveBeenCalledWith("copySsh");
  });

  it("calls onSelect('delete') when clicking delete", () => {
    const onSelect = vi.fn();
    render(<ContextMenu {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("desktop.contextDelete"));
    expect(onSelect).toHaveBeenCalledWith("delete");
  });

  it("opens submenu when clicking move to group", () => {
    const onToggleMoveToGroup = vi.fn();
    render(<ContextMenu {...defaultProps} onToggleMoveToGroup={onToggleMoveToGroup} />);
    fireEvent.click(screen.getByText("desktop.moveToGroup"));
    expect(onToggleMoveToGroup).toHaveBeenCalledWith("my-server");
  });

  it("closes submenu when clicking move to group again", () => {
    const onToggleMoveToGroup = vi.fn();
    render(<ContextMenu {...defaultProps} moveToGroupMenu="my-server" onToggleMoveToGroup={onToggleMoveToGroup} />);
    fireEvent.click(screen.getByText("desktop.moveToGroup"));
    expect(onToggleMoveToGroup).toHaveBeenCalledWith(null);
  });

  it("shows group list when submenu is open", () => {
    render(<ContextMenu {...defaultProps} moveToGroupMenu="my-server" />);
    expect(screen.getByText("desktop.groupProduction", { exact: false })).toBeTruthy();
    expect(screen.getByText("desktop.groupStaging", { exact: false })).toBeTruthy();
    expect(screen.getByText("Dev", { exact: false })).toBeTruthy();
  });

  it("marks current group with checkmark", () => {
    render(<ContextMenu {...defaultProps} moveToGroupMenu="my-server" />);
    const productionItem = screen.getByRole("menuitem", { name: /desktop.groupProduction/ });
    expect(productionItem.getAttribute("aria-current")).toBe("true");
  });

  it("calls onMoveToGroup when selecting a different group", () => {
    const onMoveToGroup = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu {...defaultProps} moveToGroupMenu="my-server" onMoveToGroup={onMoveToGroup} onClose={onClose} />);
    fireEvent.click(screen.getByText("desktop.groupStaging"));
    expect(onMoveToGroup).toHaveBeenCalledWith("my-server", "Staging");
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onMoveToGroup when selecting the current group, but still closes", () => {
    const onMoveToGroup = vi.fn();
    const onClose = vi.fn();
    // defaultConnection.group is "Production".
    render(<ContextMenu {...defaultProps} moveToGroupMenu="my-server" onMoveToGroup={onMoveToGroup} onClose={onClose} />);
    fireEvent.click(screen.getByText("desktop.groupProduction", { exact: false }));
    expect(onMoveToGroup).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key in backdrop", () => {
    const onClose = vi.fn();
    const onToggleMoveToGroup = vi.fn();
    render(<ContextMenu {...defaultProps} onClose={onClose} onToggleMoveToGroup={onToggleMoveToGroup} />);
    fireEvent.keyDown(screen.getByRole("menu").parentElement as HTMLElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onToggleMoveToGroup).toHaveBeenCalledWith(null);
  });

  it("sets aria-haspopup and aria-expanded on move to group button", () => {
    render(<ContextMenu {...defaultProps} />);
    const button = screen.getByText("desktop.moveToGroup").closest("button") as HTMLElement;
    expect(button.getAttribute("aria-haspopup")).toBe("true");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("sets aria-expanded true when submenu is open", () => {
    render(<ContextMenu {...defaultProps} moveToGroupMenu="my-server" />);
    const button = screen.getByText("desktop.moveToGroup").closest("button") as HTMLElement;
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on right-click context menu on backdrop", () => {
    const onClose = vi.fn();
    render(<ContextMenu {...defaultProps} onClose={onClose} />);
    fireEvent.contextMenu(screen.getByRole("menu").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("handles ArrowDown key to navigate menu items", () => {
    render(<ContextMenu {...defaultProps} />);
    const menu = screen.getByRole("menu");
    const items = menu.querySelectorAll('[role="menuitem"]:not([disabled])') as NodeListOf<HTMLElement>;
    items[0]?.focus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
  });

  it("handles ArrowDown when no item is focused", () => {
    render(<ContextMenu {...defaultProps} />);
    const menu = screen.getByRole("menu");
    // Don't focus any item, so indexOf returns -1
    fireEvent.keyDown(menu, { key: "ArrowDown" });
  });

  it("handles ArrowUp when no item is focused", () => {
    render(<ContextMenu {...defaultProps} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
  });

  it("handles ArrowUp after focusing last item", () => {
    render(<ContextMenu {...defaultProps} />);
    const menu = screen.getByRole("menu");
    const items = menu.querySelectorAll('[role="menuitem"]:not([disabled])') as NodeListOf<HTMLElement>;
    items[items.length - 1]?.focus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
  });

  it("does nothing for other keys", () => {
    render(<ContextMenu {...defaultProps} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Tab" });
  });

  it("handles ArrowDown with empty menu", () => {
    const { container } = render(<ContextMenu {...defaultProps} allGroupNames={[]} />);
    const menu = container.querySelector('[role="menu"]');
    if (menu) fireEvent.keyDown(menu, { key: "ArrowDown" });
  });

  it("handles ArrowUp key to navigate menu items", () => {
    render(<ContextMenu {...defaultProps} />);
    const menu = screen.getByRole("menu");
    const items = menu.querySelectorAll('[role="menuitem"]:not([disabled])') as NodeListOf<HTMLElement>;
    items[1]?.focus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
  });

  it("handles Escape key inside menu to close", () => {
    const onClose = vi.fn();
    const onToggleMoveToGroup = vi.fn();
    render(<ContextMenu {...defaultProps} onClose={onClose} onToggleMoveToGroup={onToggleMoveToGroup} />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onToggleMoveToGroup).toHaveBeenCalledWith(null);
  });
});
