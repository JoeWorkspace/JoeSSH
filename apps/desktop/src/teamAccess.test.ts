import { describe, expect, it } from "vitest";
import {
  auditEvents,
  getTeamAccessSummary,
  memberRoles,
  reviewTeamAccessRequest,
  sharedVaults,
  teamAccessRequests,
} from "./teamAccess";

describe("team access prototype state", () => {
  it("summarizes JIT access, shared vaults, and audit activity", () => {
    expect(getTeamAccessSummary()).toEqual({
      activeJitMembers: 1,
      pendingAccessRequests: 1,
      pendingVaults: 1,
      recordedEvents: 3,
    });
  });

  it("keeps team mode concepts represented in the desktop workbench", () => {
    expect(sharedVaults.map((vault) => vault.nameKey)).toContain("team.vaultProductionSsh");
    expect(memberRoles.map((member) => member.roleKey)).toContain("team.roleIncidentCommander");
    expect(auditEvents.map((event) => event.actionKey)).toContain("team.auditJitRoleIssued");
  });

  it("approves a pending team access request and records the review", () => {
    const nextState = reviewTeamAccessRequest(
      {
        accessRequests: [...teamAccessRequests],
        auditEvents: [...auditEvents],
      },
      "production-elevation",
      "approved",
      "maya.rao",
      "02:21",
    );

    expect(nextState.accessRequests[0]).toMatchObject({
      reviewer: "maya.rao",
      status: "approved",
    });
    expect(nextState.auditEvents[0]).toEqual({
      actionKey: "team.auditAccessRequestApproved",
      actor: "maya.rao",
      target: "prod-edge-01",
      time: "02:21",
    });
    expect(getTeamAccessSummary(nextState)).toMatchObject({
      activeJitMembers: 2,
      pendingAccessRequests: 0,
      recordedEvents: 4,
    });
  });

  it("is idempotent when the same request is approved twice (TOCTOU guard)", () => {
    const firstState = reviewTeamAccessRequest(
      {
        accessRequests: [...teamAccessRequests],
        auditEvents: [...auditEvents],
      },
      "production-elevation",
      "approved",
      "maya.rao",
      "02:21",
    );

    const secondState = reviewTeamAccessRequest(
      firstState,
      "production-elevation",
      "approved",
      "alice.zhao",
      "02:22",
    );

    expect(secondState.accessRequests[0]).toMatchObject({
      reviewer: "maya.rao",
      status: "approved",
    });
    expect(secondState.auditEvents.length).toBe(firstState.auditEvents.length);
    expect(secondState.auditEvents[0]).toMatchObject({
      actionKey: "team.auditAccessRequestApproved",
      actor: "maya.rao",
    });
  });

  it("returns unchanged state when the request id is unknown", () => {
    const baseline = {
      accessRequests: [...teamAccessRequests],
      auditEvents: [...auditEvents],
    };
    const nextState = reviewTeamAccessRequest(
      baseline,
      "ghost-request",
      "approved",
      "maya.rao",
      "02:25",
    );

    expect(nextState.accessRequests).toEqual(baseline.accessRequests);
    expect(nextState.auditEvents).toEqual(baseline.auditEvents);
  });

  it("rejects a pending team access request without adding active JIT access", () => {
    const nextState = reviewTeamAccessRequest(
      {
        accessRequests: [...teamAccessRequests],
        auditEvents: [...auditEvents],
      },
      "production-elevation",
      "rejected",
      "maya.rao",
      "02:23",
    );

    expect(nextState.accessRequests[0]).toMatchObject({
      reviewer: "maya.rao",
      status: "rejected",
    });
    expect(nextState.auditEvents[0]).toMatchObject({
      actionKey: "team.auditAccessRequestRejected",
      target: "prod-edge-01",
    });
    expect(getTeamAccessSummary(nextState)).toMatchObject({
      activeJitMembers: 1,
      pendingAccessRequests: 0,
      recordedEvents: 4,
    });
  });

  it("preserves unrelated requests when approving one of many", () => {
    const multipleRequests = [
      ...teamAccessRequests,
      {
        detail: "Database read access for analytics",
        id: "analytics-db",
        requestedBy: "jordan.lee",
        status: "pending" as const,
        target: "db.analytics.internal",
        title: "Analytics DB access",
      },
    ];

    const nextState = reviewTeamAccessRequest(
      {
        accessRequests: multipleRequests,
        auditEvents: [...auditEvents],
      },
      "production-elevation",
      "approved",
      "maya.rao",
      "02:30",
    );

    expect(nextState.accessRequests[0]).toMatchObject({
      id: "production-elevation",
      reviewer: "maya.rao",
      status: "approved",
    });
    expect(nextState.accessRequests[1]).toMatchObject({
      id: "analytics-db",
      status: "pending",
    });
  });
});
