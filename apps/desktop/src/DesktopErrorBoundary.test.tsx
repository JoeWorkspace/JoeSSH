// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopErrorBoundary, type DesktopErrorMonitor } from "./DesktopErrorBoundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createMonitor() {
  return {
    addBreadcrumb: vi.fn(),
    report: vi.fn(),
  } satisfies DesktopErrorMonitor;
}

function ThrowingChild(): ReactElement {
  throw new Error("render exploded");
}

describe("DesktopErrorBoundary", () => {
  it("renders children while they are healthy", () => {
    render(
      <DesktopErrorBoundary
        errorMonitor={createMonitor()}
        messageLabel="Safe localized recovery guidance"
        titleLabel="Localized crash title"
        reloadLabel="Reload workbench"
      >
        <div>Workbench ready</div>
      </DesktopErrorBoundary>,
    );

    expect(screen.getByText("Workbench ready")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the shared inline alert fallback and reports caught render errors", () => {
    const monitor = createMonitor();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <DesktopErrorBoundary
        errorMonitor={monitor}
        messageLabel="Safe localized recovery guidance"
        titleLabel="Localized crash title"
        reloadLabel="Reload workbench"
      >
        <ThrowingChild />
      </DesktopErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("inline-alert");
    expect(alert.className).toContain("error-boundary-alert");
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    expect(alert.querySelector(".inline-alert-icon svg")).toBeTruthy();
    expect(alert.querySelector(".inline-alert-copy strong")?.textContent).toBe("Localized crash title");
    expect(alert.querySelector(".inline-alert-copy small")?.textContent).toBe("Safe localized recovery guidance");
    expect(alert.textContent).not.toContain("render exploded");
    expect(screen.getByRole("heading", { name: "Localized crash title" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload workbench" })).toBeTruthy();
    expect(monitor.addBreadcrumb).toHaveBeenCalledWith(
      "react",
      "ErrorBoundary caught error",
      expect.objectContaining({ componentStack: expect.stringContaining("ThrowingChild") }),
    );
    expect(monitor.report).toHaveBeenCalledWith("render exploded", expect.any(String));
  });

  it("reloads through the injected handler", () => {
    const onReload = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <DesktopErrorBoundary
        errorMonitor={createMonitor()}
        messageLabel="Safe localized recovery guidance"
        onReload={onReload}
        titleLabel="Localized crash title"
        reloadLabel="Try again"
      >
        <ThrowingChild />
      </DesktopErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
