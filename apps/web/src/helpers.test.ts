import { describe, expect, it } from "vitest";
import {
  getDeviceStatusMeta,
  getMemberStatusMeta,
  getRoleRiskMeta,
  getRoleMessageKey,
  getScopeMessageKey,
  getAuditActionKey,
  getAuditTargetKey,
  matchKnownValue,
  formatLastSeen,
  formatClockTime,
  getClockDateTime,
} from "./helpers";
import { createLocaleFormatters } from "@atlasterm/i18n";

describe("getDeviceStatusMeta", () => {
  it("returns catching_up status with pending class", () => {
    const result = getDeviceStatusMeta("catching_up");
    expect(result.className).toBe("pendingStatus");
    expect(result.key).toBe("web.status.catchingUp");
    expect(result.stableText).toBe("Catching up");
  });

  it("returns current status without class", () => {
    const result = getDeviceStatusMeta("current");
    expect(result.className).toBeUndefined();
    expect(result.key).toBe("web.status.current");
    expect(result.stableText).toBe("Current");
  });

  it("returns degraded status with warning class", () => {
    const result = getDeviceStatusMeta("degraded");
    expect(result.className).toBe("warningStatus");
    expect(result.key).toBe("web.status.degraded");
    expect(result.stableText).toBe("Degraded");
  });

  it("returns offline status with warning class for unknown status", () => {
    const result = getDeviceStatusMeta("offline");
    expect(result.className).toBe("warningStatus");
    expect(result.key).toBe("web.status.offline");
    expect(result.stableText).toBe("Offline");
  });
});

describe("getMemberStatusMeta", () => {
  it("returns invited status with pending class", () => {
    const result = getMemberStatusMeta("invited");
    expect(result.className).toBe("pendingStatus");
    expect(result.key).toBe("web.status.invited");
  });

  it("returns suspended status with warning class", () => {
    const result = getMemberStatusMeta("suspended");
    expect(result.className).toBe("warningStatus");
    expect(result.key).toBe("web.status.suspended");
  });

  it("returns active status without class", () => {
    const result = getMemberStatusMeta("active");
    expect(result.className).toBeUndefined();
    expect(result.key).toBe("web.status.active");
  });
});

describe("getRoleRiskMeta", () => {
  it("returns limited risk with neutral class", () => {
    const result = getRoleRiskMeta("limited");
    expect(result.className).toBe("neutralStatus");
    expect(result.key).toBe("web.risk.limited");
  });

  it("returns full risk with warning class", () => {
    const result = getRoleRiskMeta("full");
    expect(result.className).toBe("warningStatus");
    expect(result.key).toBe("web.risk.full");
  });

  it("returns elevated risk with warning class", () => {
    const result = getRoleRiskMeta("elevated");
    expect(result.className).toBe("warningStatus");
    expect(result.key).toBe("web.risk.elevated");
  });
});

describe("getRoleMessageKey", () => {
  it("returns operator key for operator role", () => {
    expect(getRoleMessageKey("operator")).toBe("web.role.operator");
  });

  it("returns supportViewer key for support viewer role", () => {
    expect(getRoleMessageKey("support viewer")).toBe("web.role.supportViewer");
  });

  it("returns workspaceAdmin key for workspace admin role", () => {
    expect(getRoleMessageKey("workspace admin")).toBe("web.role.workspaceAdmin");
  });

  it("returns undefined for unknown role", () => {
    expect(getRoleMessageKey("unknown")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(getRoleMessageKey("Operator")).toBe("web.role.operator");
  });
});

describe("getScopeMessageKey", () => {
  it("returns operator scope key", () => {
    expect(getScopeMessageKey("devices, sessions, audit read")).toBe("web.scope.operator");
  });

  it("returns admin scope key", () => {
    expect(getScopeMessageKey("members, roles, sync policy")).toBe("web.scope.admin");
  });

  it("returns viewer scope key", () => {
    expect(getScopeMessageKey("read-only dashboard access")).toBe("web.scope.viewer");
  });

  it("returns undefined for unknown scope", () => {
    expect(getScopeMessageKey("unknown")).toBeUndefined();
  });
});

describe("getAuditActionKey", () => {
  it("returns profileChanges for accepted profile changes", () => {
    expect(getAuditActionKey("accepted 12 profile changes")).toBe("web.event.profileChanges");
  });

  it("returns exportBlocked for blocked export", () => {
    expect(getAuditActionKey("blocked export from unmanaged device")).toBe("web.event.exportBlocked");
  });

  it("returns roleChanged for role change", () => {
    expect(getAuditActionKey("changed jordan lee role")).toBe("web.event.roleChanged");
  });

  it("returns freshCursor for fresh cursor event", () => {
    expect(getAuditActionKey("issued fresh cursor")).toBe("web.event.freshCursor");
  });

  it("returns undefined for unknown action", () => {
    expect(getAuditActionKey("unknown action")).toBeUndefined();
  });
});

describe("getAuditTargetKey", () => {
  it("returns supportViewer for support viewer target", () => {
    expect(getAuditTargetKey("support viewer")).toBe("web.target.supportViewer");
  });

  it("returns unknownBrowser for unknown browser target", () => {
    expect(getAuditTargetKey("unknown browser")).toBe("web.target.unknownBrowser");
  });

  it("returns undefined for unknown target", () => {
    expect(getAuditTargetKey("something")).toBeUndefined();
  });
});

describe("matchKnownValue", () => {
  it("returns matching value from map", () => {
    expect(matchKnownValue("foo", { foo: "web.status.active" as any })).toBe("web.status.active");
  });

  it("is case-insensitive", () => {
    expect(matchKnownValue("FOO", { foo: "web.status.active" as any })).toBe("web.status.active");
  });

  it("trims whitespace", () => {
    expect(matchKnownValue("  foo  ", { foo: "web.status.active" as any })).toBe("web.status.active");
  });

  it("returns undefined for missing key", () => {
    expect(matchKnownValue("baz", { foo: "web.status.active" as any })).toBeUndefined();
  });
});

describe("formatLastSeen", () => {
  const formatters = createLocaleFormatters("en");
  const t = { shared: (key: string) => key, local: (key: string) => key } as any;

  it("returns live label for Live value", () => {
    expect(formatLastSeen("Live", formatters, t)).toBe("web.status.live");
  });

  it("formats minutes ago", () => {
    const result = formatLastSeen("5 min ago", formatters, t);
    expect(typeof result).toBe("string");
    expect(result).not.toBe("5 min ago");
  });

  it("formats hours ago", () => {
    const result = formatLastSeen("2 hr ago", formatters, t);
    expect(typeof result).toBe("string");
  });

  it("returns raw value for unrecognized format", () => {
    expect(formatLastSeen("yesterday", formatters, t)).toBe("yesterday");
  });

  it("returns raw non-ISO values even when JavaScript can parse them leniently", () => {
    expect(formatLastSeen("not-a-timestamp", formatters, t)).toBe("not-a-timestamp");
  });

  it("formats ISO-8601 timestamps from live mode instead of returning raw ISO", () => {
    const iso = "2026-05-24T00:00:00Z";
    const result = formatLastSeen(iso, formatters, t);
    expect(typeof result).toBe("string");
    expect(result).not.toBe(iso);
  });

  it("handles zero minutes", () => {
    const result = formatLastSeen("0 min ago", formatters, t);
    expect(typeof result).toBe("string");
  });
});

describe("formatClockTime", () => {
  const formatters = createLocaleFormatters("en");

  it("formats HH:MM clock strings", () => {
    const result = formatClockTime("14:30", formatters);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("formats single-digit hour", () => {
    const result = formatClockTime("9:05", formatters);
    expect(result).toBeTruthy();
  });

  it("formats full ISO datetime strings", () => {
    const result = formatClockTime("2026-05-24T14:30:00Z", formatters);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("handles midnight", () => {
    const result = formatClockTime("00:00", formatters);
    expect(result).toBeTruthy();
  });

  it("handles end of day", () => {
    const result = formatClockTime("23:59", formatters);
    expect(result).toBeTruthy();
  });

  it("returns raw invalid clock strings instead of rolling them into another time", () => {
    expect(formatClockTime("25:99", formatters)).toBe("25:99");
  });

  it("returns raw invalid timestamps instead of throwing", () => {
    expect(formatClockTime("not-a-timestamp", formatters)).toBe("not-a-timestamp");
  });
});

describe("getClockDateTime", () => {
  it("normalizes single-digit clock strings for machine-readable time attributes", () => {
    expect(getClockDateTime("9:05")).toBe("09:05");
  });

  it("keeps valid ISO/RFC3339-shaped timestamps", () => {
    expect(getClockDateTime("2026-05-24T14:30:00Z")).toBe("2026-05-24T14:30:00Z");
  });

  it("omits invalid clock and timestamp strings", () => {
    expect(getClockDateTime("24:60")).toBeUndefined();
    expect(getClockDateTime("not-a-timestamp")).toBeUndefined();
  });
});
