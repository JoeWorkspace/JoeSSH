// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GettingStartedOverlay } from "./GettingStartedOverlay";

const t = ((key: string) => key) as any;

afterEach(cleanup);

describe("GettingStartedOverlay", () => {
  it("explains product surfaces and telemetry boundaries", () => {
    render(
      <GettingStartedOverlay
        desktopRuntime={false}
        onClose={vi.fn()}
        onCreateConnection={vi.fn()}
        t={t}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "desktop.gettingStarted" }),
    ).toBeTruthy();
    expect(screen.getByText("desktop.surfaceGuide")).toBeTruthy();
    expect(screen.getByText("desktop.telemetryPrivacyHint")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "desktop.newConnection" }),
    ).toBeNull();
  });

  it("starts native connection creation and can be dismissed", () => {
    const onClose = vi.fn();
    const onCreateConnection = vi.fn();
    render(
      <GettingStartedOverlay
        desktopRuntime
        onClose={onClose}
        onCreateConnection={onCreateConnection}
        t={t}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "desktop.newConnection" }),
    );
    expect(onCreateConnection).toHaveBeenCalledOnce();

    const closeButtons = screen.getAllByRole("button", {
      name: "desktop.close",
    });
    const footerClose = closeButtons.at(-1);
    if (!footerClose) throw new Error("Missing onboarding close button");
    fireEvent.click(footerClose);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the Store onboarding focused on the shipped Desktop surface", () => {
    render(
      <GettingStartedOverlay
        desktopRuntime
        onClose={vi.fn()}
        onCreateConnection={vi.fn()}
        showCompanionProductSurfaces={false}
        t={t}
      />,
    );

    expect(screen.getByText("desktop.workspace")).toBeTruthy();
    expect(screen.queryByText("desktop.surfaceGuide")).toBeNull();
    expect(screen.queryByText("web.adminConsole")).toBeNull();
    expect(screen.queryByText("web.teamOverview")).toBeNull();
    expect(screen.queryByText("mobile.kicker")).toBeNull();
    expect(screen.queryByText("mobile.subtitle")).toBeNull();
  });

  it("closes on Escape without forwarding it to the workbench", () => {
    const onClose = vi.fn();
    const bubbledKeyDown = vi.fn();
    window.addEventListener("keydown", bubbledKeyDown);
    render(
      <GettingStartedOverlay
        desktopRuntime
        onClose={onClose}
        onCreateConnection={vi.fn()}
        t={t}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "desktop.gettingStarted",
    });
    fireEvent.keyDown(dialog.parentElement as HTMLElement, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
    expect(bubbledKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", bubbledKeyDown);
  });
});
