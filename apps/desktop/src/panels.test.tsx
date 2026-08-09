// @vitest-environment happy-dom
import { createLocaleFormatters, type TranslationKey } from "@atlasterm/i18n";
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import {
  formatClockTime,
  ForwardingPanel,
  InspectorPanel,
  LatencyChart,
  SettingsPanel,
  SftpPanel,
  Sparkline,
  TeamAccessPanel,
} from "./panels";

const formatters = createLocaleFormatters("en");
const messages: Partial<Record<TranslationKey, string>> = {
  "desktop.auditExport": "Audit export",
  "desktop.plannedUnavailable": "Planned; not currently available",
  "desktop.businessLayer": "Business Layer",
  "desktop.close": "Close",
  "desktop.context": "Context",
  "desktop.contextDelete": "Delete",
  "desktop.devicePosture": "Device posture",
  "desktop.download": "Download",
  "desktop.exportConnections": "Export connections",
  "desktop.forwardActive": "Active",
  "desktop.forwardAdd": "Add forward rule",
  "desktop.forwardDynamic": "Dynamic",
  "desktop.forwardInactive": "Inactive",
  "desktop.forwarding": "Port Forwarding",
  "desktop.forwardLocal": "Local",
  "desktop.forwardNoRules": "No forwarding rules yet",
  "desktop.forwardNoRulesHint":
    "Add a rule to tunnel a local TCP port over SSH.",
  "desktop.forwardRemote": "Remote",
  "desktop.forwardStart": "Start",
  "desktop.forwardStop": "Stop",
  "desktop.host": "Host",
  "desktop.importConnections": "Import connections",
  "desktop.port": "Port",
  "desktop.sftp": "Translated SFTP",
  "desktop.sftpError": "Could not list directory",
  "desktop.sftpEmpty": "This folder is empty",
  "desktop.sftpEmptyHint": "Upload a file or navigate to another folder.",
  "desktop.sftpLoading": "Loading directory...",
  "desktop.sftpOverwriteCancel": "Cancel",
  "desktop.sftpOverwriteConfirm": "Overwrite",
  "desktop.sftpOverwriteDetail":
    "A file named {name} already exists in this folder.",
  "desktop.sftpOverwriteTitle": "Replace existing file?",
  "desktop.sftpTransferring": "Transferring...",
  "desktop.sftpTransferTooLarge": "File exceeds the {limit} transfer limit.",
  "desktop.sftpTransferError": "Transfer failed",
  "desktop.sftpUp": "Up",
  "desktop.knownHosts": "Known hosts",
  "desktop.knownHostsCount": "{count} stored host keys",
  "desktop.clearKnownHosts": "Clear known hosts",
  "desktop.knownHostsEmpty": "No host keys stored yet",
  "desktop.knownHostSource": "Source: {source}",
  "desktop.knownHostFirstSeen": "First seen: {time}",
  "desktop.knownHostLastSeen": "Last seen: {time}",
  "desktop.knownHostLegacyTime": "legacy record",
  "desktop.removeKnownHost": "Remove host key",
  "desktop.confirmKnownHostRemove": "Confirm removal for {host}",
  "desktop.confirmKnownHostsClear": "Confirm clearing all stored host keys",
  "desktop.cancelKnownHostAction": "Cancel",
  "desktop.confirmKnownHostAction": "Confirm",
  "desktop.knownHostActionFailed": "Could not update known hosts",
  "desktop.connectionBusy": "Busy",
  "desktop.connectionHealthy": "Connection healthy",
  "desktop.connectionStatusOnline": "Online",
  "desktop.groupProduction": "Production group",
  "desktop.groupStaging": "Staging group",
  "desktop.live": "live",
  "desktop.locked": "Locked",
  "desktop.managePlan": "Manage plan",
  "desktop.notAvailable": "Not available",
  "desktop.noSession": "No SSH session",
  "desktop.noSessionActionDetail": "Connect before using remote actions.",
  "desktop.panelLoading": "Loading panel",
  "desktop.recordTerminal": "Record terminal sessions",
  "desktop.requiredProduction": "Required for production scopes",
  "desktop.sampleDataShort": "Sample data",
  "desktop.seatBilling": "Seat billing",
  "desktop.sharedVaults": "Shared vaults",
  "desktop.syncEncrypted": "Sync encrypted snippets",
  "desktop.telemetryErrors": "Error telemetry",
  "desktop.telemetryErrorsHint": "Send redacted crash and error summaries.",
  "desktop.telemetryPrivacyHint":
    "Optional and off by default. Never sends sensitive SSH data.",
  "desktop.thirdPartyNotices": "Third-party licenses",
  "desktop.thirdPartyNoticesHint":
    "Review the notices bundled with this exact app build.",
  "desktop.thirdPartyNoticesLoading": "Loading licenses…",
  "desktop.thirdPartyNoticesUnavailable":
    "License notices are unavailable in this build.",
  "desktop.team": "Team",
  "desktop.upload": "Upload",
  "desktop.workspaceSettings": "Workspace Settings",
  "team.access": "Team Access",
  "team.accessSummary": "Team access summary",
  "team.auditEvents": "Audit events",
  "team.auditTrail": "Audit Trail",
  "team.business": "Business",
  "team.jitActive": "JIT active",
  "team.memberRoles": "Member Roles",
  "team.pending": "pending",
  "team.review": "Review",
  "team.reviewedBy": "reviewed by {reviewer}",
  "team.sharedVault": "Shared Vault",
  "team.statusApproved": "Approved",
  "team.statusRejected": "Rejected",
  "team.statusRecording": "Recording",
  "team.vaultProductionSsh": "Production SSH",
  "team.vaultProductionSshScope": "18 hosts",
  "team.vaultProductionSshOwners": "SRE leads",
  "team.vaultDatabaseBreakGlass": "Database break-glass",
  "team.vaultDatabaseBreakGlassScope": "4 clusters",
  "team.vaultDatabaseBreakGlassOwners": "Data platform",
  "team.vaultCiDeployKeys": "CI deploy keys",
  "team.vaultCiDeployKeysScope": "12 runners",
  "team.vaultCiDeployKeysOwners": "Release ops",
  "team.roleIncidentCommander": "Incident commander",
  "team.roleSreReviewer": "SRE reviewer",
  "team.roleReadOnlyObserver": "Read-only observer",
  "team.accessJitActive": "JIT active",
  "team.accessApprover": "Approver",
  "team.accessSessionView": "Session view",
  "team.auditJitRoleIssued": "JIT role issued",
  "team.auditVaultShareApproved": "Vault share approved",
  "team.auditCommandRecorded": "Command recorded",
  "team.auditAccessRequestApproved": "Access request approved",
  "team.auditAccessRequestRejected": "Access request rejected",
  "team.productionElevation": "Production elevation",
  "team.productionElevationDetail":
    "Incident commander role for gateway triage",
};

function t(key: TranslationKey, values?: Record<string, string | number>) {
  let template = messages[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    template = template.replaceAll(`{${name}}`, String(value));
  }
  return template;
}

const activeConnection: ComponentProps<
  typeof InspectorPanel
>["activeConnection"] = {
  color: "good",
  group: "Production",
  host: "10.48.12.11",
  latencyHistory: [32, 29, 35, 27, 30, 26, 28],
  latencyMs: 28,
  name: "prod-edge-01",
  status: "online",
  tags: ["gateway", "ssh"],
};

const connectionWithoutLatency: ComponentProps<
  typeof InspectorPanel
>["activeConnection"] = {
  color: "good",
  group: "Staging",
  host: "10.48.12.99",
  name: "staging-edge-01",
  status: "connected",
  tags: ["staging"],
};
const inspectorConnectionStats: ComponentProps<
  typeof InspectorPanel
>["connectionStats"] = {
  averageLatencyMs: 37,
  onlineConnections: 6,
  totalConnections: 8,
};
const inspectorSessionContext: ComponentProps<
  typeof InspectorPanel
>["sessionContext"] = {
  regionLabel: "us-east / edge",
  userHandle: "lin.chen",
};

function renderInspectorPanel(
  activeConnectionOverride = activeConnection,
  hasActiveSession = true,
  connectionStatsOverride = inspectorConnectionStats,
) {
  return (
    <InspectorPanel
      activeConnection={activeConnectionOverride}
      connectionStats={connectionStatsOverride}
      formatters={formatters}
      hasActiveSession={hasActiveSession}
      sessionContext={inspectorSessionContext}
      t={t}
    />
  );
}

const sftpItems: ComponentProps<typeof SftpPanel>["sftpItems"] = [
  {
    modified: { unit: "hour", value: -2 },
    name: "deployments",
    sizeBytes: undefined,
    type: "dir",
  },
  {
    modified: { unit: "minute", value: -15 },
    name: "session.log",
    sizeBytes: 4096,
    type: "file",
  },
];

describe("panel charts", () => {
  it("renders sparkline coordinates for empty and single-point series without NaN", () => {
    const emptyHtml = renderToStaticMarkup(
      <Sparkline color="good" values={[]} />,
    );
    const singleHtml = renderToStaticMarkup(
      <Sparkline color="warn" values={[42]} />,
    );

    expect(emptyHtml).toContain('class="sparkline"');
    expect(singleHtml).toContain('class="sparkline"');
    expect(`${emptyHtml}${singleHtml}`).not.toMatch(/NaN|Infinity/);
  });

  it("renders accessible latency charts for empty and single-point series without NaN", () => {
    const emptyHtml = renderToStaticMarkup(
      <LatencyChart
        color="info"
        label="Latency chart, average 0 ms"
        values={[]}
      />,
    );
    const singleHtml = renderToStaticMarkup(
      <LatencyChart
        color="good"
        label="Latency chart, average 42 ms"
        values={[42]}
      />,
    );

    expect(emptyHtml).toContain('aria-label="Latency chart, average 0 ms"');
    expect(singleHtml).toContain('aria-label="Latency chart, average 42 ms"');
    expect(emptyHtml).toContain('role="img"');
    expect(singleHtml).toContain('role="img"');
    expect(`${emptyHtml}${singleHtml}`).not.toMatch(/NaN|Infinity/);
  });
});

describe("extracted desktop panels", () => {
  it("renders the inspector content without an artificial loading delay", () => {
    const html = renderToStaticMarkup(renderInspectorPanel());

    expect(html).toContain('aria-label="Context"');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("prod-edge-01");
    expect(html).toContain("10.48.12.11");
    expect(html).not.toContain("skeleton--card");
    expect(html).not.toContain('aria-busy="true"');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("renders latency metrics when connection has latencyMs and latencyHistory", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(renderInspectorPanel());
      act(() => {
        vi.advanceTimersByTime(700);
      });
      const html = container.innerHTML;
      expect(html).toContain("28");
      expect(html).toContain("Online");
      expect(html).toContain("Production group");
      expect(html).toContain("lin.chen");
      expect(html).toContain("us-east / edge");
      expect(html).toContain("37 ms");
      expect(html).not.toContain(">online<");
      expect(html).not.toContain("skeleton--card");
    } finally {
      vi.useRealTimers();
    }
  });

  it("labels sample fixture connections without online status copy", () => {
    vi.useFakeTimers();
    try {
      const sampleConnection = {
        ...activeConnection,
        color: "neutral" as const,
        latencyHistory: undefined,
        latencyMs: undefined,
        status: "sample",
      };
      const { container } = render(renderInspectorPanel(sampleConnection));
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(container.innerHTML).toContain("Sample data");
      expect(container.innerHTML).not.toContain('ui-badge--good">Online');
      expect(container.innerHTML).not.toContain("latency-chart");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses no-session inspector copy and disables remote runbook actions when disconnected", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        renderInspectorPanel(activeConnection, false),
      );
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(container.innerHTML).toContain("No SSH session");
      expect(container.innerHTML).toContain(
        "Connect before using remote actions.",
      );
      expect(container.innerHTML).not.toContain("trusted");
      expect(container.innerHTML).not.toContain(
        "Production SSH with recording",
      );
      for (const button of container.querySelectorAll(".runbook-item button")) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect((button as HTMLButtonElement).title).toBe(
          "Connect before using remote actions.",
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders without latency metrics when connection lacks latencyMs and latencyHistory", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        renderInspectorPanel(connectionWithoutLatency),
      );
      act(() => {
        vi.advanceTimersByTime(700);
      });
      const html = container.innerHTML;
      expect(html).not.toContain("skeleton--card");
      expect(html).not.toContain("latency-value");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not invent a zero-millisecond fleet average when no latency was measured", () => {
    const { container } = render(
      renderInspectorPanel(connectionWithoutLatency, true, {
        averageLatencyMs: undefined,
        onlineConnections: 1,
        totalConnections: 1,
      }),
    );

    expect(container.innerHTML).toContain("Not available");
    expect(container.innerHTML).not.toContain("0 ms");
  });

  it("does not leak NaN/Infinity for an empty latencyHistory", () => {
    vi.useFakeTimers();
    try {
      const emptyHistory = {
        ...activeConnection,
        latencyHistory: [] as number[],
      };
      const { container } = render(renderInspectorPanel(emptyHistory));
      act(() => {
        vi.advanceTimersByTime(700);
      });
      const html = container.innerHTML;
      expect(html).not.toMatch(/NaN|Infinity|∞/);
      expect(html).not.toContain("latency-chart");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders SFTP file rows with localized file size and relative time", () => {
    const html = renderToStaticMarkup(
      <SftpPanel formatters={formatters} sftpItems={sftpItems} t={t} />,
    );

    expect(html).toContain("/srv/atlas");
    expect(html).toContain("Sample data");
    expect(html).toContain("deployments");
    expect(html).toContain("session.log");
    expect(html).toContain("Not available");
    expect(html).toContain("4 kB");
    expect(html).toContain("15 minutes ago");
  });

  it("disables static SFTP fixture actions without a live transfer session", () => {
    const { container } = render(
      <SftpPanel formatters={formatters} sftpItems={sftpItems} t={t} />,
    );

    const toolbarButtons = container.querySelectorAll(".sftp-toolbar button");
    expect((toolbarButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((toolbarButtons[1] as HTMLButtonElement).disabled).toBe(true);
    expect((toolbarButtons[0] as HTMLButtonElement).title).toBe(
      "Connect before using remote actions.",
    );
    for (const fileButton of container.querySelectorAll(".file-list button")) {
      expect((fileButton as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("renders live SFTP entries from a real directory listing when active", () => {
    const html = renderToStaticMarkup(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/var/remote",
          status: {
            phase: "ready",
            entries: [
              { name: "remote.conf", is_dir: false, size: 2048 },
              { name: "data", is_dir: true, size: null },
            ],
          },
        }}
      />,
    );

    expect(html).toContain("/var/remote");
    expect(html).toContain("remote.conf");
    expect(html).toContain("data");
    expect(html).toContain("2 kB");
    expect(html).toContain("Not available"); // directory size fallback
    expect(html).not.toContain(">-<");
    expect(html).not.toContain("session.log"); // static items are replaced
  });

  it("renders the live SFTP loading state", () => {
    const html = renderToStaticMarkup(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{ active: true, path: "/p", status: { phase: "loading" } }}
      />,
    );
    expect(html).toContain("sftp-state sftp-state--loading");
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading directory...");
  });

  it("renders the live SFTP error state", () => {
    const html = renderToStaticMarkup(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/p",
          status: { phase: "error", message: "denied" },
        }}
      />,
    );
    expect(html).toContain("sftp-state sftp-state--error");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not list directory");
    expect(html).toContain("denied");
  });

  it("keeps the static SFTP fallback when the directory is inactive", () => {
    const html = renderToStaticMarkup(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{ active: false, path: "/x", status: { phase: "idle" } }}
      />,
    );
    expect(html).toContain("session.log");
    expect(html).toContain("/srv/atlas");
  });

  it("wires SFTP upload, file selection, toolbar download, and transfer states", () => {
    const onUpload = vi.fn();
    const onDownload = vi.fn();
    const onOpenDir = vi.fn();
    const onGoUp = vi.fn();
    const { container, rerender } = render(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/srv",
          status: {
            phase: "ready",
            entries: [
              { name: "app.log", is_dir: false, size: 12 },
              { name: "sub", is_dir: true, size: null },
            ],
          },
          onOpenDir,
          onGoUp,
          canGoUp: true,
        }}
        transfer={{ status: { phase: "idle" }, onUpload, onDownload }}
      />,
    );

    (
      container.querySelector(".sftp-toolbar button") as HTMLButtonElement
    ).click();
    const uploadFile = new File(["fresh"], "fresh.log", { type: "text/plain" });
    fireEvent.change(
      container.querySelector(
        '.sftp-toolbar input[type="file"]',
      ) as HTMLInputElement,
      { target: { files: [uploadFile] } },
    );
    expect(onUpload).toHaveBeenCalledWith(uploadFile, "/srv");
    const toolbarButtons = container.querySelectorAll(".sftp-toolbar button");
    const downloadButton = toolbarButtons[1] as HTMLButtonElement;
    expect(downloadButton.disabled).toBe(true);

    const entries = container.querySelectorAll(".file-list button");
    act(() => {
      (entries[0] as HTMLButtonElement).click(); // file -> selected for toolbar download
    });
    expect((entries[0] as HTMLButtonElement).className).toContain(
      "is-selected",
    );
    expect((entries[0] as HTMLButtonElement).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(downloadButton.disabled).toBe(false);
    downloadButton.click();
    expect(onDownload).toHaveBeenCalledWith("app.log", 12, "/srv");
    (entries[1] as HTMLButtonElement).click(); // directory -> navigate, not download
    expect(onOpenDir).toHaveBeenCalledWith("sub");
    expect(onDownload).toHaveBeenCalledTimes(1);

    // The Up button (enabled when canGoUp) navigates to the parent.
    const upBtn = Array.from(
      container.querySelectorAll(".sftp-toolbar button"),
    ).find((b) => b.textContent?.trim() === "Up") as HTMLButtonElement;
    upBtn.click();
    expect(onGoUp).toHaveBeenCalled();

    rerender(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/srv",
          status: { phase: "ready", entries: [] },
        }}
        transfer={{ status: { phase: "transferring" }, onUpload, onDownload }}
      />,
    );
    expect(
      container.querySelector(".sftp-state--transfer")?.textContent,
    ).toContain("Transferring...");

    rerender(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/srv",
          status: { phase: "ready", entries: [] },
        }}
        transfer={{
          status: { phase: "error", message: "quota" },
          onUpload,
          onDownload,
        }}
      />,
    );
    expect(
      container.querySelector(".sftp-state--error")?.textContent,
    ).toContain("Transfer failed");
    expect(
      container.querySelector(".sftp-state--error")?.textContent,
    ).toContain("quota");
    expect(
      container.querySelector(".sftp-state--error")?.getAttribute("role"),
    ).toBe("alert");
  });

  it("disables unsafe live SFTP entry names before navigation or download", () => {
    const onUpload = vi.fn();
    const onDownload = vi.fn();
    const onOpenDir = vi.fn();
    const { container } = render(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/srv",
          status: {
            phase: "ready",
            entries: [
              { name: "../secret", is_dir: false, size: 12 },
              { name: "sub/dir", is_dir: true, size: null },
              { name: "safe.log", is_dir: false, size: 6 },
            ],
          },
          onOpenDir,
          canGoUp: true,
        }}
        transfer={{ status: { phase: "idle" }, onUpload, onDownload }}
      />,
    );

    const entries = container.querySelectorAll(".file-list button");
    expect((entries[0] as HTMLButtonElement).disabled).toBe(true);
    expect((entries[0] as HTMLButtonElement).title).toBe("Not available");
    expect((entries[1] as HTMLButtonElement).disabled).toBe(true);
    expect((entries[2] as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(entries[0] as HTMLButtonElement);
    fireEvent.click(entries[1] as HTMLButtonElement);
    expect(onDownload).not.toHaveBeenCalled();
    expect(onOpenDir).not.toHaveBeenCalled();
  });

  it("requires confirmation before overwriting an existing SFTP file", () => {
    const onUpload = vi.fn();
    const onDownload = vi.fn();
    const { container } = render(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/srv",
          status: {
            phase: "ready",
            entries: [{ name: "app.log", is_dir: false, size: 12 }],
          },
        }}
        transfer={{ status: { phase: "idle" }, onUpload, onDownload }}
      />,
    );

    const input = container.querySelector(
      '.sftp-toolbar input[type="file"]',
    ) as HTMLInputElement;
    const firstAttempt = new File(["replace"], "app.log", {
      type: "text/plain",
    });
    fireEvent.change(input, { target: { files: [firstAttempt] } });

    expect(onUpload).not.toHaveBeenCalled();
    expect(
      container.querySelector(".sftp-overwrite-confirm")?.textContent,
    ).toContain("Replace existing file?");
    expect(
      container.querySelector(".sftp-overwrite-confirm")?.textContent,
    ).toContain("A file named app.log already exists in this folder.");

    fireEvent.click(
      within(
        container.querySelector(".sftp-overwrite-confirm") as HTMLElement,
      ).getByRole("button", { name: "Cancel" }),
    );
    expect(onUpload).not.toHaveBeenCalled();
    expect(container.querySelector(".sftp-overwrite-confirm")).toBeNull();

    const confirmedAttempt = new File(["replace"], "app.log", {
      type: "text/plain",
    });
    fireEvent.change(input, { target: { files: [confirmedAttempt] } });
    fireEvent.click(
      within(
        container.querySelector(".sftp-overwrite-confirm") as HTMLElement,
      ).getByRole("button", { name: "Overwrite" }),
    );

    expect(onUpload).toHaveBeenCalledWith(confirmedAttempt, "/srv");
    expect(container.querySelector(".sftp-overwrite-confirm")).toBeNull();
  });

  it("clears pending SFTP overwrite confirmation when the directory changes", () => {
    const onUpload = vi.fn();
    const onDownload = vi.fn();
    const { container, rerender } = render(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/srv",
          status: {
            phase: "ready",
            entries: [{ name: "app.log", is_dir: false, size: 12 }],
          },
        }}
        transfer={{ status: { phase: "idle" }, onUpload, onDownload }}
      />,
    );

    const input = container.querySelector(
      '.sftp-toolbar input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["replace"], "app.log", { type: "text/plain" })],
      },
    });
    expect(container.querySelector(".sftp-overwrite-confirm")).not.toBeNull();

    rerender(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/srv/archive",
          status: {
            phase: "ready",
            entries: [{ name: "app.log", is_dir: false, size: 12 }],
          },
        }}
        transfer={{ status: { phase: "idle" }, onUpload, onDownload }}
      />,
    );

    expect(container.querySelector(".sftp-overwrite-confirm")).toBeNull();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("renders team access summary and review controls", () => {
    const html = renderToStaticMarkup(
      <TeamAccessPanel formatters={formatters} t={t} />,
    );

    expect(html).toContain("Team Access");
    expect(html).toContain("Team access summary");
    expect(html).toContain("Review");
    expect(html).toContain("Shared Vault");
    expect(html).toContain("Audit Trail");
    expect(html).toContain("Production elevation");
    expect(html).toContain("Incident commander role for gateway triage");
  });

  it("renders forwarding rules with localized state and direction labels", () => {
    const html = renderToStaticMarkup(<ForwardingPanel t={t} />);

    expect(html).toContain("Port Forwarding");
    expect(html).toContain("Local");
    expect(html).not.toContain("Remote</span>");
    expect(html).not.toContain("Dynamic</span>");
    expect(html).toContain("Inactive");
  });

  it("renders settings controls and localized import/export actions", () => {
    const html = renderToStaticMarkup(<SettingsPanel t={t} />);

    expect(html).toContain("Workspace Settings");
    expect(html).toContain("Record terminal sessions");
    expect(html).toContain("Planned; not currently available");
    expect(html).toContain("Export connections");
    expect(html).toContain("Import connections");
    expect(html).toContain("Third-party licenses");
    expect(html).toContain("License notices are unavailable in this build.");
    expect(html).toContain("Business Layer");
    const { container } = render(<SettingsPanel t={t} />);
    expect(
      container.querySelector(".commercial-card > header")?.textContent,
    ).toContain("Planned; not currently available");
    expect(html).toContain('disabled=""');
  });

  it("marks policy and commercial placeholders as unavailable controls", () => {
    const { container } = render(<SettingsPanel t={t} />);
    const policyToggles = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(policyToggles).toHaveLength(2);
    expect(policyToggles.every((toggle) => toggle.disabled)).toBe(true);
    expect(policyToggles.every((toggle) => !toggle.checked)).toBe(true);

    const managePlan = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Manage plan"),
    ) as HTMLButtonElement;
    expect(managePlan.disabled).toBe(true);
  });

  it("hides recording, Sync, and Business placeholders for release builds", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel showFutureProductSurfaces={false} t={t} />,
    );

    expect(html).toContain("Workspace Settings");
    expect(html).toContain("Third-party licenses");
    expect(html).not.toContain("Record terminal sessions");
    expect(html).not.toContain("Sync encrypted snippets");
    expect(html).not.toContain("Business Layer");
    expect(html).not.toContain("Manage plan");
  });

  it("renders telemetry consent control and wires changes", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <SettingsPanel
        t={t}
        telemetry={{ available: true, enabled: false, onChange }}
      />,
    );

    expect(container.innerHTML).toContain("Error telemetry");
    expect(container.innerHTML).toContain(
      "Optional and off by default. Never sends sensitive SSH data.",
    );
    const checkbox = Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    ).find((input) =>
      input.closest("label")?.textContent?.includes("Error telemetry"),
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);

    checkbox.click();
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <SettingsPanel
        t={t}
        telemetry={{ available: false, enabled: false, onChange }}
      />,
    );
    const disabledCheckbox = Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    ).find((input) =>
      input.closest("label")?.textContent?.includes("Error telemetry"),
    ) as HTMLInputElement;
    expect(disabledCheckbox.disabled).toBe(true);
  });

  it("renders vault status dots with correct tones for approved, pending, and recording", () => {
    const html = renderToStaticMarkup(
      <TeamAccessPanel formatters={formatters} t={t} />,
    );

    expect(html).toContain("status-dot--good");
    expect(html).toContain("status-dot--warn");
    expect(html).toContain("status-dot--info");
    expect(html).toContain('aria-label="Approved"');
    expect(html).toContain('aria-label="pending"');
    expect(html).toContain('aria-label="Recording"');
    expect(html).not.toContain(">approved<");
    expect(html).not.toContain(">recording<");
  });

  it("renders member roles with handles and access levels", () => {
    const html = renderToStaticMarkup(
      <TeamAccessPanel formatters={formatters} t={t} />,
    );

    expect(html).toContain("lin.chen");
    expect(html).toContain("maya.rao");
    expect(html).toContain("noah.kim");
    expect(html).toContain("Incident commander");
    expect(html).toContain("SRE reviewer");
    expect(html).toContain("Read-only observer");
    expect(html).toContain("Approver");
    expect(html).toContain("Session view");
  });

  it("renders audit trail events with formatted timestamps", () => {
    const html = renderToStaticMarkup(
      <TeamAccessPanel formatters={formatters} t={t} />,
    );

    expect(html).toContain("JIT role issued");
    expect(html).toContain("Vault share approved");
    expect(html).toContain("Command recorded");
  });

  it("renders latency chart with gradient and data points", () => {
    const html = renderToStaticMarkup(
      <LatencyChart
        color="good"
        label="Latency chart"
        values={[32, 29, 35, 27, 30]}
      />,
    );

    expect(html).toContain("linearGradient");
    expect(html).toContain("polygon");
    expect(html).toContain("polyline");
    expect(html).toContain("<circle");
  });

  it("renders latency chart with all color variants", () => {
    for (const color of [
      "neutral",
      "good",
      "warn",
      "info",
      "premium",
    ] as const) {
      const html = renderToStaticMarkup(
        <LatencyChart
          color={color}
          label={`Chart ${color}`}
          values={[10, 20, 30]}
        />,
      );
      expect(html).toContain(`latency-grad-${color}`);
    }
  });

  it("renders only local forwarding examples for the supported desktop backend", () => {
    const html = renderToStaticMarkup(<ForwardingPanel t={t} />);

    expect(html).toContain("forward-rule");
    expect(html).not.toContain("is-active");
    expect(html).toContain("127.0.0.1:5432");
    expect(html).toContain("cache.prod.internal:6379");
    expect(html).not.toContain("0.0.0.0:8080");
    expect(html).not.toContain("localhost:9090");
  });

  it("disables fixture forwarding controls without live forward handlers", () => {
    const { container } = render(<ForwardingPanel t={t} />);

    for (const button of container.querySelectorAll(
      ".forward-rule-actions button",
    )) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect((button as HTMLButtonElement).title).toBe(
        "Connect before using remote actions.",
      );
    }
  });

  it("renders empty forwarding state when rules array is empty", () => {
    const html = renderToStaticMarkup(<ForwardingPanel t={t} rules={[]} />);

    expect(html).toContain("empty-state");
    expect(html).toContain("No forwarding rules yet");
    expect(html).toContain("Add a rule to tunnel a local TCP port over SSH.");
    expect(html).not.toContain("forward-rule");
  });

  it("renders an emotional empty state for live SFTP directories with no entries", () => {
    const html = renderToStaticMarkup(
      <SftpPanel
        formatters={formatters}
        sftpItems={sftpItems}
        t={t}
        directory={{
          active: true,
          path: "/empty",
          status: { phase: "ready", entries: [] },
        }}
      />,
    );

    expect(html).toContain("empty-state");
    expect(html).toContain("This folder is empty");
    expect(html).toContain("Upload a file or navigate to another folder.");
  });

  it("shows live forward runtime (bound address + active) and an error, and wires start/stop", () => {
    const rules = [
      {
        id: "fwd-a",
        direction: "Local" as const,
        bindHost: "127.0.0.1",
        bindPort: 5432,
        targetHost: "db",
        targetPort: 5432,
        active: false,
      },
      {
        id: "fwd-b",
        direction: "Local" as const,
        bindHost: "127.0.0.1",
        bindPort: 6379,
        targetHost: "cache",
        targetPort: 6379,
        active: false,
      },
    ];
    const onStart = vi.fn();
    const onStop = vi.fn();
    const forwards = {
      runtime: {
        "fwd-a": { active: true, boundAddr: "127.0.0.1:55001" },
        "fwd-b": { active: false, error: "bind denied" },
      },
      onStart,
      onStop,
    };
    const { container } = render(
      <ForwardingPanel t={t} rules={rules} forwards={forwards} />,
    );

    expect(container.innerHTML).toContain("127.0.0.1:55001"); // live bound address
    const alert = container.querySelector(".inline-alert.forward-error");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.getAttribute("aria-atomic")).toBe("true");
    expect(alert?.querySelector(".inline-alert-icon svg")).toBeTruthy();
    expect(alert?.querySelector(".inline-alert-copy strong")?.textContent).toBe(
      "bind denied",
    );
    expect(alert?.querySelector(".inline-alert-copy small")).toBeNull();

    const actionButtons = container.querySelectorAll(
      ".forward-rule-actions button",
    );
    // fwd-a is active -> clicking stops it; fwd-b inactive -> clicking starts it.
    (actionButtons[0] as HTMLButtonElement).click();
    expect(onStop).toHaveBeenCalledWith("fwd-a");
    (actionButtons[1] as HTMLButtonElement).click();
    expect(onStart).toHaveBeenCalledWith(
      "fwd-b",
      "127.0.0.1:6379",
      "cache",
      6379,
    );
  });

  it("disables forwarding controls while a start or stop action is pending", () => {
    const rules = [
      {
        id: "fwd-a",
        direction: "Local" as const,
        bindHost: "127.0.0.1",
        bindPort: 5432,
        targetHost: "db",
        targetPort: 5432,
        active: false,
      },
      {
        id: "fwd-b",
        direction: "Local" as const,
        bindHost: "127.0.0.1",
        bindPort: 6379,
        targetHost: "cache",
        targetPort: 6379,
        active: false,
      },
    ];
    const onStart = vi.fn();
    const onStop = vi.fn();
    const { container } = render(
      <ForwardingPanel
        t={t}
        rules={rules}
        forwards={{
          runtime: {
            "fwd-a": { active: false, pending: true },
            "fwd-b": {
              active: true,
              pending: true,
              boundAddr: "127.0.0.1:55001",
            },
          },
          onStart,
          onStop,
        }}
      />,
    );

    const actionButtons = container.querySelectorAll(
      ".forward-rule-actions button",
    );
    expect((actionButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((actionButtons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("creates a local forwarding rule from the add form and starts it", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const { container } = render(
      <ForwardingPanel
        t={t}
        rules={[]}
        forwards={{ runtime: {}, onStart, onStop }}
      />,
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "Add forward rule" }));

    expect((view.getByLabelText("Local Host") as HTMLInputElement).value).toBe(
      "127.0.0.1",
    );
    expect((view.getByLabelText("Local Port") as HTMLInputElement).value).toBe(
      "0",
    );
    expect((view.getByLabelText("Remote Port") as HTMLInputElement).value).toBe(
      "5432",
    );

    fireEvent.change(view.getByLabelText("Remote Host"), {
      target: { value: "db.internal" },
    });
    fireEvent.change(view.getByLabelText("Remote Port"), {
      target: { value: "5432" },
    });
    fireEvent.click(
      container.querySelector(
        '.forward-rule-form-actions button[type="submit"]',
      ) as HTMLButtonElement,
    );

    expect(container.innerHTML).toContain("127.0.0.1:0");
    expect(container.innerHTML).toContain("db.internal:5432");

    const startButton = view.getAllByRole("button", {
      name: "Start",
    })[0] as HTMLButtonElement;
    fireEvent.click(startButton);
    expect(onStart).toHaveBeenCalledWith(
      "custom-fwd-1",
      "127.0.0.1:0",
      "db.internal",
      5432,
    );
    expect(onStop).not.toHaveBeenCalled();
  });

  it("supports controlled custom forwarding rules across panel remounts", () => {
    const onAddCustomRule = vi.fn();
    const onRemoveCustomRule = vi.fn();
    const customRules = [
      {
        active: false,
        bindHost: "127.0.0.1",
        bindPort: 9000,
        direction: "Local" as const,
        id: "custom-fwd-7",
        targetHost: "service.internal",
        targetPort: 443,
      },
    ];
    const { container } = render(
      <ForwardingPanel
        customRules={customRules}
        onAddCustomRule={onAddCustomRule}
        onRemoveCustomRule={onRemoveCustomRule}
        rules={[]}
        t={t}
      />,
    );

    expect(container.innerHTML).toContain("service.internal:443");
    const deleteButton = within(container).getByRole("button", {
      name: "Delete",
    });
    fireEvent.click(deleteButton);
    expect(onRemoveCustomRule).toHaveBeenCalledWith("custom-fwd-7");
  });

  it("does not allow an active custom forward to be deleted before it is stopped", () => {
    const rule = {
      active: false,
      bindHost: "127.0.0.1",
      bindPort: 9000,
      direction: "Local" as const,
      id: "custom-fwd-7",
      targetHost: "service.internal",
      targetPort: 443,
    };
    const { container } = render(
      <ForwardingPanel
        customRules={[rule]}
        forwards={{
          onStart: vi.fn(),
          onStop: vi.fn(),
          runtime: {
            [rule.id]: {
              active: true,
            },
          },
        }}
        rules={[]}
        t={t}
      />,
    );

    expect(
      (
        within(container).getByRole("button", {
          name: "Delete",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("rejects unsafe forwarding bind hosts", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const { container } = render(
      <ForwardingPanel
        t={t}
        rules={[]}
        forwards={{ runtime: {}, onStart, onStop }}
      />,
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "Add forward rule" }));
    fireEvent.change(view.getByLabelText("Local Host"), {
      target: { value: "0.0.0.0" },
    });
    fireEvent.change(view.getByLabelText("Remote Host"), {
      target: { value: "db.internal" },
    });

    const submitButton = container.querySelector(
      '.forward-rule-form-actions button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(view.queryByRole("button", { name: "Start" })).toBeNull();
    expect(container.innerHTML).not.toContain("db.internal:5432");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("formats IPv6 loopback bind addresses for created forwarding rules", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const { container } = render(
      <ForwardingPanel
        t={t}
        rules={[]}
        forwards={{ runtime: {}, onStart, onStop }}
      />,
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "Add forward rule" }));
    fireEvent.change(view.getByLabelText("Local Host"), {
      target: { value: "::1" },
    });
    fireEvent.change(view.getByLabelText("Remote Host"), {
      target: { value: "db.internal" },
    });
    fireEvent.click(
      container.querySelector(
        '.forward-rule-form-actions button[type="submit"]',
      ) as HTMLButtonElement,
    );

    fireEvent.click(
      view.getAllByRole("button", { name: "Start" })[0] as HTMLButtonElement,
    );
    expect(onStart).toHaveBeenCalledWith(
      "custom-fwd-1",
      "[::1]:0",
      "db.internal",
      5432,
    );
  });

  it("formatClockTime returns the raw value when it does not match a clock pattern", () => {
    const result = formatClockTime("not-a-time", formatters);
    expect(result).toBe("not-a-time");
  });

  it("formatClockTime formats a valid clock string", () => {
    const result = formatClockTime("14:30", formatters);
    expect(typeof result).toBe("string");
    expect(result).not.toBe("14:30");
  });

  it('formatClockTime returns "now" as relative time', () => {
    const result = formatClockTime("now", formatters);
    expect(typeof result).toBe("string");
  });

  it("handles file import with no file selected", () => {
    const html = renderToStaticMarkup(<SettingsPanel t={t} />);
    expect(html).toContain("settings");
  });

  it("exports the provided custom connections as a JSON download", () => {
    const created = vi.fn();
    let downloadedFilename = "";
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => {
      created();
      return "blob:x";
    };
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedFilename = this.download;
      });
    try {
      const conns = [
        { name: "box", host: "10.0.0.1", group: "Personal", tags: ["ssh"] },
      ];
      const { container } = render(
        <SettingsPanel
          t={t}
          connectionsIO={{ exportConnections: conns, onImport: vi.fn() }}
        />,
      );
      const exportBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Export connections"),
      ) as HTMLButtonElement;
      exportBtn.click();
      expect(created).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(downloadedFilename).toBe("joessh-connections.json");
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      clickSpy.mockRestore();
    }
  });

  it("surfaces invalid connection import files through the parent error callback", async () => {
    const onImport = vi.fn();
    const onImportError = vi.fn();
    const badFile = new File(["not-json"], "bad.json", {
      type: "application/json",
    });
    const { container } = render(
      <SettingsPanel
        t={t}
        connectionsIO={{ exportConnections: [], onImport, onImportError }}
      />,
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [badFile] } });

    await waitFor(() => {
      expect(onImportError).toHaveBeenCalled();
    });
    expect(onImport).not.toHaveBeenCalled();
  });

  it("rejects oversized connection import files before reading them", () => {
    const onImport = vi.fn();
    const onImportError = vi.fn();
    const { container } = render(
      <SettingsPanel
        t={t}
        connectionsIO={{ exportConnections: [], onImport, onImportError }}
      />,
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const oversizedFile = new File(
      [new Uint8Array(1024 * 1024 + 1)],
      "oversized.json",
      { type: "application/json" },
    );

    fireEvent.change(input, { target: { files: [oversizedFile] } });

    expect(onImportError).toHaveBeenCalledOnce();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("shows the stored known-host count and confirms before clearing them", async () => {
    const onClear = vi.fn();
    const onRemove = vi.fn();
    const { container, rerender } = render(
      <SettingsPanel
        t={t}
        knownHosts={{ count: 3, entries: [], onClear, onRemove }}
      />,
    );
    expect(container.innerHTML).toContain("3 stored host keys");
    const clearBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Clear known hosts"),
    ) as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(false);
    act(() => {
      clearBtn.click();
    });
    expect(onClear).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain(
      "Confirm clearing all stored host keys",
    );
    const confirmBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm"),
    ) as HTMLButtonElement;
    await act(async () => {
      confirmBtn.click();
    });
    expect(onClear).toHaveBeenCalled();

    rerender(
      <SettingsPanel
        t={t}
        knownHosts={{ count: 0, entries: [], onClear, onRemove }}
      />,
    );
    const emptyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Clear known hosts"),
    ) as HTMLButtonElement;
    expect(emptyBtn.disabled).toBe(true);
    expect(container.innerHTML).toContain("No host keys stored yet");
  });

  it("lists known-host pins with audit metadata and confirms before removing one pin", async () => {
    const onRemove = vi.fn();
    const { container } = render(
      <SettingsPanel
        t={t}
        knownHosts={{
          count: 1,
          entries: [
            {
              key: "example.com:22",
              host: "example.com",
              port: 22,
              fingerprint: "SHA256:abc",
              first_seen_at_ms: 1700000000000,
              last_seen_at_ms: null,
              source: "confirmed",
            },
          ],
          onClear: vi.fn(),
          onRemove,
        }}
      />,
    );

    expect(container.innerHTML).toContain("example.com:22");
    expect(container.innerHTML).toContain("SHA256:abc");
    expect(container.innerHTML).toContain("Source: confirmed");
    expect(container.innerHTML).toContain("Last seen: legacy record");
    const removeBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Remove host key"),
    ) as HTMLButtonElement;
    act(() => {
      removeBtn.click();
    });
    expect(onRemove).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain("Confirm removal for example.com:22");
    const confirmBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm"),
    ) as HTMLButtonElement;
    await act(async () => {
      confirmBtn.click();
    });
    expect(onRemove).toHaveBeenCalledWith("example.com:22");
  });
});
