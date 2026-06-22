// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PanelLoadingState } from "./PanelLoadingState";

const t = ((key: string) => key) as any;

afterEach(() => {
  cleanup();
});

describe("PanelLoadingState", () => {
  it("renders an accessible loading status with non-announced skeletons", () => {
    render(<PanelLoadingState t={t} />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("desktop.panelLoading")).toBeTruthy();
    expect(screen.getByText("desktop.panelLoadingHint")).toBeTruthy();
    expect(status.querySelector(".panel-loading-icon")).toBeTruthy();
    expect(status.querySelector(".panel-loading-skeleton")?.getAttribute("aria-hidden")).toBe("true");
  });
});
