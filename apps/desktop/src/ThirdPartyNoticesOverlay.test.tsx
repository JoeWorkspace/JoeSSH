// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThirdPartyNoticesOverlay } from "./ThirdPartyNoticesOverlay";

const t = ((key: string) => key) as any;

afterEach(cleanup);

describe("ThirdPartyNoticesOverlay", () => {
  it("renders notices and closes from the backdrop or close control", () => {
    const onClose = vi.fn();
    render(
      <ThirdPartyNoticesOverlay
        notices="Dependency notice"
        onClose={onClose}
        t={t}
      />,
    );

    expect(screen.getByRole("dialog", { name: "desktop.thirdPartyNotices" })).toBeTruthy();
    expect(screen.getByText("Dependency notice")).toBeTruthy();

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "desktop.close" }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes only for Escape on the backdrop", () => {
    const onClose = vi.fn();
    render(<ThirdPartyNoticesOverlay notices="Notice" onClose={onClose} t={t} />);
    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;

    fireEvent.keyDown(backdrop, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(backdrop, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
