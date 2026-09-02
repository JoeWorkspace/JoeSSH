import { describe, expect, it, vi } from "vitest";
import {
  getDeviceStatusMeta,
  getMemberStatusMeta,
  getRoleRiskMeta,
  getRoleMessageKey,
  getScopeMessageKey,
  getAuditActionKey,
  getAuditTargetKey,
  formatLastSeen,
  formatClockTime,
  getClockDateTime,
} from "./helpers";

describe("getDeviceStatusMeta", () => {
  it("returns catching_up status with pendingStatus class", () => {
    const meta = getDeviceStatusMeta("catching_up");
    expect(meta.className).toBe("pendingStatus");
    expect(meta.key).toBe("web.status.catchingUp");
    expect(meta.stableText).toBe("Catching up");
  });

  it("returns current status without className", () => {
    const meta = getDeviceStatusMeta("current");
    expect(meta.className).toBeUndefined();
    expect(meta.key).toBe("web.status.current");
    expect(meta.stableText).toBe("Current");
  });

  it("returns degraded status with warningStatus class", () => {
    const meta = getDeviceStatusMeta("degraded");
    expect(meta.className).toBe("warningStatus");
    expect(meta.key).toBe("web.status.degraded");
    expect(meta.stableText).toBe("Degraded");
  });

  it("returns offline status with warningStatus class", () => {
    const meta = getDeviceStatusMeta("offline");
    expect(meta.className).toBe("warningStatus");
    expect(meta.key).toBe("web.status.offline");
    expect(meta.stableText).toBe("Offline");
  });
});

describe("getMemberStatusMeta", () => {
  it("returns invited status with pendingStatus class", () => {
    const meta = getMemberStatusMeta("invited");
    expect(meta.className).toBe("pendingStatus");
    expect(meta.key).toBe("web.status.invited");
  });

  it("returns suspended status with warningStatus class", () => {
    const meta = getMemberStatusMeta("suspended");
    expect(meta.className).toBe("warningStatus");
    expect(meta.key).toBe("web.status.suspended");
  });

  it("returns active status without className", () => {
    const meta = getMemberStatusMeta("active");
    expect(meta.className).toBeUndefined();
    expect(meta.key).toBe("web.status.active");
  });
});

describe("getRoleRiskMeta", () => {
  it("returns limited risk with neutralStatus class", () => {
    const meta = getRoleRiskMeta("limited");
    expect(meta.className).toBe("neutralStatus");
    expect(meta.key).toBe("web.risk.limited");
  });

  it("returns full risk with warningStatus class", () => {
    const meta = getRoleRiskMeta("full");
    expect(meta.className).toBe("warningStatus");
    expect(meta.key).toBe("web.risk.full");
  });

  it("returns elevated risk with warningStatus class", () => {
    const meta = getRoleRiskMeta("elevated");
    expect(meta.className).toBe("warningStatus");
    expect(meta.key).toBe("web.risk.elevated");
  });
});

describe("getRoleMessageKey", () => {
  it("returns key for operator role", () => {
    expect(getRoleMessageKey("operator")).toBe("web.role.operator");
  });

  it("returns key for support viewer role", () => {
    expect(getRoleMessageKey("support viewer")).toBe("web.role.supportViewer");
  });

  it("returns key for workspace admin role", () => {
    expect(getRoleMessageKey("workspace admin")).toBe(
      "web.role.workspaceAdmin",
    );
  });

  it("returns undefined for unknown role", () => {
    expect(getRoleMessageKey("unknown")).toBeUndefined();
  });

  it("handles case insensitivity", () => {
    expect(getRoleMessageKey("Operator")).toBe("web.role.operator");
  });
});

describe("getScopeMessageKey", () => {
  it("returns key for operator scope", () => {
    expect(getScopeMessageKey("devices, sessions, audit read")).toBe(
      "web.scope.operator",
    );
  });

  it("returns key for admin scope", () => {
    expect(getScopeMessageKey("members, roles, sync policy")).toBe(
      "web.scope.admin",
    );
  });

  it("returns key for viewer scope", () => {
    expect(getScopeMessageKey("read-only dashboard access")).toBe(
      "web.scope.viewer",
    );
  });

  it("returns undefined for unknown scope", () => {
    expect(getScopeMessageKey("unknown")).toBeUndefined();
  });
});

describe("getAuditActionKey", () => {
  it("returns key for profile changes action", () => {
    expect(getAuditActionKey("accepted 12 profile changes")).toBe(
      "web.event.profileChanges",
    );
  });

  it("returns key for export blocked action", () => {
    expect(getAuditActionKey("blocked export from unmanaged device")).toBe(
      "web.event.exportBlocked",
    );
  });

  it("returns key for role changed action", () => {
    expect(getAuditActionKey("changed jordan lee role")).toBe(
      "web.event.roleChanged",
    );
  });

  it("returns key for fresh cursor action", () => {
    expect(getAuditActionKey("issued fresh cursor")).toBe(
      "web.event.freshCursor",
    );
  });

  it("returns undefined for unknown action", () => {
    expect(getAuditActionKey("unknown")).toBeUndefined();
  });
});

describe("getAuditTargetKey", () => {
  it("returns key for support viewer target", () => {
    expect(getAuditTargetKey("support viewer")).toBe(
      "web.target.supportViewer",
    );
  });

  it("returns key for unknown browser target", () => {
    expect(getAuditTargetKey("unknown browser")).toBe(
      "web.target.unknownBrowser",
    );
  });

  it("returns undefined for unknown target", () => {
    expect(getAuditTargetKey("unknown")).toBeUndefined();
  });
});

describe("formatLastSeen", () => {
  const mockFormatters = {
    relativeTime: vi.fn(
      (amount: number, unit: string) => `${Math.abs(amount)} ${unit}(s) ago`,
    ),
    number: vi.fn(),
    date: vi.fn(),
    time: vi.fn(),
  };
  const mockT = {
    local: vi.fn((key: string) => key),
    shared: vi.fn((key: string) => key),
  };

  it("returns live translation for Live value", () => {
    const result = formatLastSeen("Live", mockFormatters as any, mockT as any);
    expect(result).toBe("web.status.live");
    expect(mockT.local).toHaveBeenCalledWith("web.status.live");
  });

  it("returns relative time for minutes ago", () => {
    const result = formatLastSeen(
      "5 min ago",
      mockFormatters as any,
      mockT as any,
    );
    expect(result).toBe("5 minute(s) ago");
    expect(mockFormatters.relativeTime).toHaveBeenCalledWith(-5, "minute");
  });

  it("returns relative time for hours ago", () => {
    const result = formatLastSeen(
      "2 hr ago",
      mockFormatters as any,
      mockT as any,
    );
    expect(result).toBe("2 hour(s) ago");
    expect(mockFormatters.relativeTime).toHaveBeenCalledWith(-2, "hour");
  });

  it("returns original value for non-matching format", () => {
    const result = formatLastSeen(
      "yesterday",
      mockFormatters as any,
      mockT as any,
    );
    expect(result).toBe("yesterday");
  });

  it("handles case insensitivity in time format", () => {
    const result = formatLastSeen(
      "3 MIN AGO",
      mockFormatters as any,
      mockT as any,
    );
    expect(result).toBe("3 minute(s) ago");
  });
});

describe("formatClockTime", () => {
  const mockFormatters = {
    time: vi.fn((_value: any, _options: any) => "14:30"),
    relativeTime: vi.fn(),
    number: vi.fn(),
    date: vi.fn(),
  };

  it("formats HH:MM time string", () => {
    const result = formatClockTime("14:30", mockFormatters as any);
    expect(result).toBe("14:30");
    expect(mockFormatters.time).toHaveBeenCalledWith(
      Date.UTC(2026, 4, 24, 14, 30),
      { hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
    );
  });

  it("formats H:MM time string", () => {
    const result = formatClockTime("9:15", mockFormatters as any);
    expect(result).toBe("14:30");
    expect(mockFormatters.time).toHaveBeenCalledWith(
      Date.UTC(2026, 4, 24, 9, 15),
      { hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
    );
  });

  it("formats non-matching string as-is", () => {
    const mockFormatters2 = {
      time: vi.fn(() => "formatted"),
      relativeTime: vi.fn(),
      number: vi.fn(),
      date: vi.fn(),
    };
    const result = formatClockTime(
      "2026-05-24T14:30:00Z",
      mockFormatters2 as any,
    );
    expect(result).toBe("formatted");
    expect(mockFormatters2.time).toHaveBeenCalledWith("2026-05-24T14:30:00Z", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  });

  it("returns invalid clock strings without formatting rollover", () => {
    const mockFormatters2 = {
      time: vi.fn(() => "formatted"),
      relativeTime: vi.fn(),
      number: vi.fn(),
      date: vi.fn(),
    };

    const result = formatClockTime("24:60", mockFormatters2 as any);

    expect(result).toBe("24:60");
    expect(mockFormatters2.time).not.toHaveBeenCalled();
  });

  it("returns invalid timestamp strings instead of throwing", () => {
    const mockFormatters2 = {
      time: vi.fn(() => {
        throw new RangeError("Invalid time value");
      }),
      relativeTime: vi.fn(),
      number: vi.fn(),
      date: vi.fn(),
    };

    const result = formatClockTime("not-a-timestamp", mockFormatters2 as any);

    expect(result).toBe("not-a-timestamp");
  });
});

describe("getClockDateTime", () => {
  it("returns normalized valid clock strings", () => {
    expect(getClockDateTime("9:15")).toBe("09:15");
    expect(getClockDateTime("14:30")).toBe("14:30");
  });

  it("returns ISO timestamps and omits invalid dynamic strings", () => {
    expect(getClockDateTime("2026-05-24T14:30:00Z")).toBe(
      "2026-05-24T14:30:00Z",
    );
    expect(getClockDateTime("24:60")).toBeUndefined();
    expect(getClockDateTime("not-a-timestamp")).toBeUndefined();
  });
});

describe("web entry telemetry policy", () => {
  it("keeps telemetry default-off and versioned for Public Beta", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain("VITE_ATLASTERM_TELEMETRY_OPT_IN");
    expect(content).toContain("createNoopErrorMonitor");
    expect(content).toContain("0.1.0-beta.26");
    expect(content).not.toContain("version: '0.1.0'");
    expect(content).not.toContain('version: "0.1.0"');
  });

  it("wires runtime telemetry disable to clean up transport", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain("setTelemetryEnabled");
    expect(content).toContain("errorMonitor.install()");
    expect(content).toContain("uninstall?.()");
    expect(content).toContain("errorMonitor.disable()");
    expect(content).toContain("setTelemetryEnabled(nextEnabled)");
  });
});

describe("web release shell build", () => {
  it("keeps the critical shell injection wired before SRI", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const packageJsonPath = path.resolve(__dirname, "../package.json");
    const inlineShellPath = path.resolve(__dirname, "../inline-shell.mjs");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const inlineShell = fs.readFileSync(inlineShellPath, "utf-8");

    expect(packageJson.scripts.build).toContain("node inline-shell.mjs");
    expect(
      packageJson.scripts.build.indexOf("node inline-shell.mjs"),
    ).toBeLessThan(
      packageJson.scripts.build.indexOf("apply-subresource-integrity.mjs"),
    );
    expect(inlineShell).toContain("data-joessh-critical-shell");
    expect(inlineShell).toContain("adminShellSkeleton");
    expect(inlineShell).not.toContain("Math.random");
  });
});
