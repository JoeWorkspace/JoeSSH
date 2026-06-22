// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "./StatusBar";
import { createLocaleFormatters } from "@atlasterm/i18n";

const t = ((key: string, values?: Record<string, string | number>) => {
  if (values) return `${key}:${JSON.stringify(values)}`;
  return key;
}) as any;

const defaultTeamAccess = { activeJitMembers: 3, pendingAccessRequests: 0, pendingVaults: 1, recordedEvents: 2 };

afterEach(() => {
  cleanup();
});

describe("StatusBar", () => {
  it("renders all status buttons", () => {
    render(
      <StatusBar
        activeConnection={{ latencyMs: 42 }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getByText("desktop.sessions")).toBeTruthy();
    expect(screen.getByText("desktop.syncHealthy")).toBeTruthy();
    expect(screen.getByText("team.summary", { exact: false })).toBeTruthy();
  });

  it("shows no-session copy instead of live fleet status when disconnected", () => {
    render(
      <StatusBar
        activeConnection={{ latencyMs: 42 }}
        formatters={createLocaleFormatters("en")}
        hasActiveSession={false}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getAllByText("desktop.noSession").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("desktop.notAvailable")).toBeTruthy();
    expect(screen.queryByText(/42/)).toBeNull();
    expect(screen.queryByText("desktop.syncHealthy")).toBeNull();
  });

  it("displays latency when latencyMs is provided", () => {
    render(
      <StatusBar
        activeConnection={{ latencyMs: 42 }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getByText(/42/)).toBeTruthy();
  });

  it("displays 0 latency when latencyMs is 0", () => {
    render(
      <StatusBar
        activeConnection={{ latencyMs: 0 }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getByText(/0/)).toBeTruthy();
  });

  it("falls back to 0 when latencyMs is undefined", () => {
    render(
      <StatusBar
        activeConnection={{ latencyMs: undefined }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getByText(/0/)).toBeTruthy();
  });

  it("displays latencyLabel when latencyMs is not provided", () => {
    render(
      <StatusBar
        activeConnection={{ latencyLabel: "Fast" }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getByText("Fast")).toBeTruthy();
  });

  it("displays localized latencyLabelKey when latencyMs is not provided", () => {
    render(
      <StatusBar
        activeConnection={{ latencyLabelKey: "desktop.mfaRequiredShort" }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getByText("desktop.mfaRequiredShort")).toBeTruthy();
  });

  it("prioritizes numeric latency over latencyLabelKey", () => {
    render(
      <StatusBar
        activeConnection={{ latencyMs: 12, latencyLabelKey: "desktop.mfaRequiredShort" }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getByText(/12/)).toBeTruthy();
    expect(screen.queryByText("desktop.mfaRequiredShort")).toBeNull();
  });

  it("displays localized fallback when neither latencyMs nor latencyLabel", () => {
    render(
      <StatusBar
        activeConnection={{}}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getByText("desktop.notAvailable")).toBeTruthy();
  });

  it("adds localized action labels to status buttons", () => {
    render(
      <StatusBar
        activeConnection={{ latencyMs: 42 }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    expect(screen.getByLabelText("desktop.sessionContext")).toBeTruthy();
    expect(screen.getByLabelText("desktop.openSftp")).toBeTruthy();
    expect(screen.getByLabelText("desktop.latencyHistory")).toBeTruthy();
    expect(screen.getByLabelText("team.accessSummary")).toBeTruthy();
  });

  it("calls onPanelChange('inspector') when clicking sessions button", () => {
    const onPanelChange = vi.fn();
    render(
      <StatusBar
        activeConnection={{ latencyMs: 10 }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={onPanelChange}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    fireEvent.click(screen.getByText("desktop.sessions"));
    expect(onPanelChange).toHaveBeenCalledWith("inspector");
  });

  it("calls onPanelChange('sftp') when clicking sync button", () => {
    const onPanelChange = vi.fn();
    render(
      <StatusBar
        activeConnection={{ latencyMs: 10 }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={onPanelChange}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    fireEvent.click(screen.getByText("desktop.syncHealthy"));
    expect(onPanelChange).toHaveBeenCalledWith("sftp");
  });

  it("calls onPanelChange('inspector') when clicking latency button", () => {
    const onPanelChange = vi.fn();
    render(
      <StatusBar
        activeConnection={{ latencyMs: 10 }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={onPanelChange}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    fireEvent.click(screen.getByLabelText("desktop.latencyHistory"));
    expect(onPanelChange).toHaveBeenCalledWith("inspector");
  });

  it("calls onPanelChange('team') when clicking team summary button", () => {
    const onPanelChange = vi.fn();
    render(
      <StatusBar
        activeConnection={{ latencyMs: 10 }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={onPanelChange}
        t={t}
        teamAccess={defaultTeamAccess}
      />,
    );
    fireEvent.click(screen.getByLabelText("team.accessSummary"));
    expect(onPanelChange).toHaveBeenCalledWith("team");
  });

  it("renders team summary with formatted numbers", () => {
    render(
      <StatusBar
        activeConnection={{ latencyMs: 10 }}
        formatters={createLocaleFormatters("en")}
        onPanelChange={vi.fn()}
        t={t}
        teamAccess={{ activeJitMembers: 5, pendingAccessRequests: 1, pendingVaults: 2, recordedEvents: 4 }}
      />,
    );
    expect(screen.getByText("team.summary", { exact: false })).toBeTruthy();
  });
});
