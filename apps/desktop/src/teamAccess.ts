import type { TranslationKey } from "@atlasterm/i18n";

export type TeamAccessStatus = "approved" | "pending" | "recording";
export type TeamAccessReviewDecision = "approved" | "rejected";
export type TeamAccessRequestStatus = "approved" | "pending" | "rejected";

export type TeamAuditEvent = {
  action?: string;
  actionKey?: TranslationKey;
  actor: string;
  target: string;
  targetKey?: TranslationKey;
  time: string;
};

export type TeamAccessRequest = {
  detail?: string;
  detailKey?: TranslationKey;
  id: string;
  requestedBy: string;
  reviewer?: string;
  status: TeamAccessRequestStatus;
  target: string;
  title?: string;
  titleKey?: TranslationKey;
};

export type TeamAccessState = {
  accessRequests?: readonly TeamAccessRequest[];
  auditEvents?: readonly TeamAuditEvent[];
};
export type MutableTeamAccessState = {
  accessRequests: TeamAccessRequest[];
  auditEvents: TeamAuditEvent[];
};

export const sharedVaults = [
  { nameKey: "team.vaultProductionSsh", scopeKey: "team.vaultProductionSshScope", ownersKey: "team.vaultProductionSshOwners", status: "approved" },
  { nameKey: "team.vaultDatabaseBreakGlass", scopeKey: "team.vaultDatabaseBreakGlassScope", ownersKey: "team.vaultDatabaseBreakGlassOwners", status: "pending" },
  { nameKey: "team.vaultCiDeployKeys", scopeKey: "team.vaultCiDeployKeysScope", ownersKey: "team.vaultCiDeployKeysOwners", status: "recording" },
] as const satisfies Array<{
  nameKey: TranslationKey;
  scopeKey: TranslationKey;
  ownersKey: TranslationKey;
  status: TeamAccessStatus;
}>;

export const memberRoles = [
  { name: "Lin Chen", handle: "lin.chen", roleKey: "team.roleIncidentCommander", accessKey: "team.accessJitActive" },
  { name: "Maya Rao", handle: "maya.rao", roleKey: "team.roleSreReviewer", accessKey: "team.accessApprover" },
  { name: "Noah Kim", handle: "noah.kim", roleKey: "team.roleReadOnlyObserver", accessKey: "team.accessSessionView" },
] as const;

export const auditEvents = [
  { time: "02:17", actor: "lin.chen", actionKey: "team.auditJitRoleIssued", target: "prod-edge-01" },
  { time: "02:11", actor: "maya.rao", actionKey: "team.auditVaultShareApproved", target: "", targetKey: "team.vaultProductionSsh" },
  { time: "01:58", actor: "atlas-policy", actionKey: "team.auditCommandRecorded", target: "", targetKey: "desktop.gatewayShell" },
] as const satisfies readonly TeamAuditEvent[];

export const teamAccessRequests = [
  {
    detailKey: "team.productionElevationDetail",
    id: "production-elevation",
    requestedBy: "lin.chen",
    status: "pending",
    target: "prod-edge-01",
    titleKey: "team.productionElevation",
  },
] as const satisfies readonly TeamAccessRequest[];

export type TeamAccessSummary = {
  activeJitMembers: number;
  pendingAccessRequests: number;
  pendingVaults: number;
  recordedEvents: number;
};

export function getTeamAccessSummary(state: TeamAccessState = {}): TeamAccessSummary {
  const requests = state.accessRequests ?? teamAccessRequests;
  const events = state.auditEvents ?? auditEvents;
  const pendingVaults = sharedVaults.filter((vault) => vault.status === "pending").length;
  const pendingAccessRequests = requests.filter((request) => request.status === "pending").length;
  const approvedAccessRequests = requests.filter((request) => request.status === "approved").length;
  const activeJitMembers = memberRoles.filter((member) => member.accessKey === "team.accessJitActive").length;
  const currentActiveJitMembers = activeJitMembers + approvedAccessRequests;
  const recordedEvents = events.length;

  return {
    activeJitMembers: currentActiveJitMembers,
    pendingAccessRequests,
    pendingVaults,
    recordedEvents,
  };
}

export function reviewTeamAccessRequest(
  state: Required<TeamAccessState>,
  requestId: string,
  decision: TeamAccessReviewDecision,
  reviewer = "maya.rao",
  time = "now",
): MutableTeamAccessState {
  const request = state.accessRequests.find((candidate) => candidate.id === requestId);

  if (!request || request.status !== "pending") {
    return {
      accessRequests: [...state.accessRequests],
      auditEvents: [...state.auditEvents],
    };
  }

  const accessRequests = state.accessRequests.map((candidate) =>
    candidate.id === requestId
      ? {
          ...candidate,
          reviewer,
          status: decision,
        }
      : candidate,
  );
  const auditEvent: TeamAuditEvent = {
    actionKey: decision === "approved" ? "team.auditAccessRequestApproved" : "team.auditAccessRequestRejected",
    actor: reviewer,
    target: request.target,
    time,
  };

  return {
    accessRequests,
    auditEvents: [auditEvent, ...state.auditEvents],
  };
}
