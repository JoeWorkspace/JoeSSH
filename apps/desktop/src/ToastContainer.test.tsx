// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastContainer } from "./ToastContainer";
import type { Toast } from "./useToast";

afterEach(() => {
  cleanup();
});

describe("ToastContainer", () => {
  it("renders nothing when toasts array is empty", () => {
    const { container } = render(<ToastContainer toasts={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders success toast with message", () => {
    const toasts: Toast[] = [{ id: 1, message: "Connected!", tone: "success" }];
    render(<ToastContainer toasts={toasts} />);
    expect(screen.getByText("Connected!")).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("toast--success");
    expect(screen.getByText("Connected!").previousElementSibling?.className).toContain("toast-icon");
  });

  it("renders error toast as an assertive alert", () => {
    const toasts: Toast[] = [{ id: 2, message: "Connection failed", tone: "error" }];
    render(<ToastContainer toasts={toasts} />);
    expect(screen.getByText("Connection failed")).toBeTruthy();
    expect(screen.getByRole("alert").className).toContain("toast--error");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders warning toast as a polite status", () => {
    const toasts: Toast[] = [{ id: 3, message: "Syncing...", tone: "warning" }];
    render(<ToastContainer toasts={toasts} />);
    expect(screen.getByText("Syncing...")).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("toast--warning");
  });

  it("renders multiple toasts", () => {
    const toasts: Toast[] = [
      { id: 1, message: "First", tone: "success" },
      { id: 2, message: "Second", tone: "error" },
    ];
    render(<ToastContainer toasts={toasts} />);
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("applies tone-specific CSS class", () => {
    const toasts: Toast[] = [{ id: 1, message: "Test", tone: "success" }];
    render(<ToastContainer toasts={toasts} />);
    expect(screen.getByText("Test").closest(".toast")?.className).toContain("toast--success");
  });

  it("sets aria-live on container", () => {
    const toasts: Toast[] = [{ id: 1, message: "Test", tone: "warning" }];
    render(<ToastContainer toasts={toasts} />);
    expect(screen.getByText("Test").closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
  });
});
