// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsOverlay } from "./ShortcutsOverlay";

const t = ((key: string) => key) as any;

afterEach(() => {
  cleanup();
});

describe("ShortcutsOverlay", () => {
  it("renders the dialog with a translated title", () => {
    render(<ShortcutsOverlay onClose={vi.fn()} t={t} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText("desktop.keyboardShortcuts").length).toBeGreaterThan(0);
  });

  it("focuses the non-interactive dialog and restores its opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<ShortcutsOverlay onClose={vi.fn()} t={t} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("renders every shortcut row through the translator", () => {
    render(<ShortcutsOverlay onClose={vi.fn()} t={t} />);
    expect(screen.getByText("desktop.commandPalette")).toBeTruthy();
    expect(screen.getByText("desktop.shortcutSwitchConnection")).toBeTruthy();
    expect(screen.getByText("desktop.shortcutToggleTheme")).toBeTruthy();
    expect(screen.getByText("desktop.shortcutCommandHistory")).toBeTruthy();
    expect(screen.queryByText("Toggle theme")).toBeNull();
  });

  it("hides native-only quick connect in browser previews", () => {
    render(<ShortcutsOverlay desktopRuntime={false} onClose={vi.fn()} t={t} />);

    expect(screen.queryByText("desktop.quickConnect")).toBeNull();
    expect(screen.getByText("desktop.new")).toBeTruthy();
  });

  it("closes when clicking the backdrop", () => {
    const onClose = vi.fn();
    render(<ShortcutsOverlay onClose={onClose} t={t} />);
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when clicking inside the panel", () => {
    const onClose = vi.fn();
    render(<ShortcutsOverlay onClose={onClose} t={t} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    const bubbledKeyDown = vi.fn();
    window.addEventListener("keydown", bubbledKeyDown);
    render(<ShortcutsOverlay onClose={onClose} t={t} />);
    fireEvent.keyDown(screen.getByRole("dialog").parentElement as HTMLElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(bubbledKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", bubbledKeyDown);
  });

  it("ignores non-Escape keydown on the backdrop", () => {
    const onClose = vi.fn();
    render(<ShortcutsOverlay onClose={onClose} t={t} />);
    fireEvent.keyDown(screen.getByRole("dialog").parentElement as HTMLElement, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
