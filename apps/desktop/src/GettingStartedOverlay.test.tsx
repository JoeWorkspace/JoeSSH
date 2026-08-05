// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GettingStartedOverlay } from "./GettingStartedOverlay";

const t = ((key: string) => key) as any;

afterEach(cleanup);

describe("GettingStartedOverlay", () => {
  it("renders the first task without stacking legacy surface and telemetry panels", () => {
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
    expect(
      screen
        .getByRole("dialog", { name: "desktop.gettingStarted" })
        .querySelector(".lucide-list-checks"),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "desktop.gettingStartedStepCreate",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("desktop.gettingStartedStepCreateDetail"),
    ).toBeTruthy();
    expect(screen.getByText("desktop.gettingStartedSampleData")).toBeTruthy();
    expect(screen.queryByText("desktop.telemetryPrivacyHint")).toBeNull();
    expect(screen.queryByText("web.adminConsole")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "desktop.newConnection" }),
    ).toBeNull();
  });

  it("navigates the three task steps and invokes their existing entry points", () => {
    const onClose = vi.fn();
    const onCreateConnection = vi.fn();
    const onOpenConnect = vi.fn();
    const onOpenTerminal = vi.fn();
    const onOpenSftp = vi.fn();
    const onOpenForwarding = vi.fn();
    const onStepChange = vi.fn();
    render(
      <GettingStartedOverlay
        desktopRuntime
        onClose={onClose}
        onCreateConnection={onCreateConnection}
        onOpenConnect={onOpenConnect}
        onOpenTerminal={onOpenTerminal}
        onOpenSftp={onOpenSftp}
        onOpenForwarding={onOpenForwarding}
        onStepChange={onStepChange}
        t={t}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "desktop.newConnection" }),
    );
    expect(onCreateConnection).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: "desktop.gettingStartedNext" }),
    );
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "desktop.gettingStartedStepSecure",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.gettingStartedOpenConnect" }),
    );
    expect(onOpenConnect).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: "desktop.gettingStartedNext" }),
    );
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "desktop.gettingStartedStepUse",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "desktop.gettingStartedOpenTerminal",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.gettingStartedOpenSftp" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "desktop.gettingStartedOpenForwarding",
      }),
    );
    expect(onOpenTerminal).toHaveBeenCalledOnce();
    expect(onOpenSftp).toHaveBeenCalledOnce();
    expect(onOpenForwarding).toHaveBeenCalledOnce();
    expect(onStepChange).toHaveBeenCalledWith(1);
    expect(onStepChange).toHaveBeenCalledWith(2);
  });

  it("keeps Store onboarding to the three shipped Desktop tasks", () => {
    render(
      <GettingStartedOverlay
        desktopRuntime
        onClose={vi.fn()}
        onCreateConnection={vi.fn()}
        showCompanionProductSurfaces={false}
        t={t}
      />,
    );

    expect(screen.getAllByText("desktop.gettingStartedStepCreate").length).toBe(
      2,
    );
    expect(screen.getAllByText("desktop.gettingStartedStepSecure").length).toBe(
      1,
    );
    expect(screen.getAllByText("desktop.gettingStartedStepUse").length).toBe(1);
    expect(screen.queryByText("desktop.surfaceGuide")).toBeNull();
    expect(screen.queryByText("web.adminConsole")).toBeNull();
    expect(screen.queryByText("web.teamOverview")).toBeNull();
    expect(screen.queryByText("mobile.kicker")).toBeNull();
    expect(screen.queryByText("mobile.subtitle")).toBeNull();
  });

  it("hides the Connect CTA for non-desktop runtimes", () => {
    render(
      <GettingStartedOverlay
        desktopRuntime={false}
        initialStep={1}
        onClose={vi.fn()}
        onCreateConnection={vi.fn()}
        onOpenConnect={vi.fn()}
        t={t}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: "desktop.gettingStartedOpenConnect",
      }),
    ).toBeNull();
  });

  it("restores the requested step and distinguishes skip from completion", () => {
    const onSkip = vi.fn();
    const onComplete = vi.fn();
    const { rerender } = render(
      <GettingStartedOverlay
        desktopRuntime
        initialStep={2}
        onClose={vi.fn()}
        onComplete={onComplete}
        onCreateConnection={vi.fn()}
        onSkip={onSkip}
        t={t}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "desktop.gettingStartedStepUse",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.gettingStartedSkip" }),
    );
    expect(onSkip).toHaveBeenCalledOnce();

    rerender(
      <GettingStartedOverlay
        desktopRuntime
        initialStep={2}
        onClose={vi.fn()}
        onComplete={onComplete}
        onCreateConnection={vi.fn()}
        onSkip={onSkip}
        t={t}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.gettingStartedComplete" }),
    );
    expect(onComplete).toHaveBeenCalledOnce();
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

  it("keeps onboarding content inside an RTL workbench", () => {
    render(
      <div dir="rtl">
        <GettingStartedOverlay
          desktopRuntime
          onClose={vi.fn()}
          onCreateConnection={vi.fn()}
          t={t}
        />
      </div>,
    );

    const dialog = screen.getByRole("dialog", {
      name: "desktop.gettingStarted",
    });
    expect(dialog.closest('[dir="rtl"]')).toBeTruthy();
    expect(screen.getByText("desktop.gettingStartedSampleData")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.gettingStartedNext" }),
    );
    const nextIcon = screen
      .getByRole("button", { name: "desktop.gettingStartedNext" })
      .querySelector(".getting-started-nav-icon");
    expect(nextIcon).toBeTruthy();
    expect(dialog.closest('[dir="rtl"]')?.getAttribute("dir")).toBe("rtl");
  });

  it("keeps long translated copy in bounded content containers", () => {
    const longTranslator = ((key: string) =>
      `${key} ${"long localized text ".repeat(80)}`) as any;
    render(
      <GettingStartedOverlay
        desktopRuntime
        onClose={vi.fn()}
        onCreateConnection={vi.fn()}
        t={longTranslator}
      />,
    );

    const content = document.querySelector(".getting-started-step-content");
    expect(content).toBeTruthy();
    expect(content?.className).toContain("getting-started-step-content");
    expect(content?.textContent?.length).toBeGreaterThan(1000);
  });
});
