// @vitest-environment happy-dom
import { createLocaleFormatters, type TranslationKey } from '@atlasterm/i18n';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InspectorPanel,
  SettingsPanel,
  TeamAccessPanel,
} from './panels';

const formatters = createLocaleFormatters('en');
const messages: Partial<Record<TranslationKey, string>> = {
  'desktop.host': 'Host',
  'desktop.group': 'Group',
  'desktop.tags': 'Tags',
  'desktop.avgLatency': 'Avg latency',
  'desktop.latencyHistory': 'Latency history',
  'desktop.latencyChartLabel': 'Latency chart, average {average}',
  'desktop.sessionContext': 'Session context',
  'desktop.trusted': 'Trusted',
  'desktop.user': 'User',
  'desktop.policy': 'Policy',
  'desktop.productionPolicy': 'Production policy',
  'desktop.region': 'Region',
  'desktop.connectionStats': 'Connection stats',
  'desktop.connections': 'Connections',
  'desktop.connectionsOnline': 'Online',
  'desktop.connectionStatusOnline': 'Online',
  'desktop.groupProduction': 'Production group',
  'desktop.runbook': 'Runbook',
  'desktop.attached': 'Attached',
  'desktop.gatewayTriage': 'Gateway triage',
  'desktop.run': 'Run',
  'desktop.openSecureTunnel': 'Open secure tunnel',
  'desktop.start': 'Start',
  'desktop.exportConnections': 'Export connections',
  'desktop.importConnections': 'Import connections',
  'desktop.workspaceSettings': 'Workspace Settings',
  'desktop.recordTerminal': 'Record terminal sessions',
  'desktop.requiredProduction': 'Required for production scopes',
  'desktop.syncEncrypted': 'Sync encrypted snippets',
  'desktop.telemetryErrors': 'Error telemetry',
  'desktop.telemetryErrorsHint': 'Send redacted crash and error summaries.',
  'desktop.telemetryPrivacyHint': 'Optional and off by default. Never sends sensitive SSH data.',
  'desktop.availableProBusiness': 'Available on Pro and Business',
  'desktop.businessLayer': 'Business Layer',
  'desktop.team': 'Team',
  'desktop.sharedVaults': 'Shared vaults',
  'desktop.auditExport': 'Audit export',
  'desktop.devicePosture': 'Device posture',
  'desktop.seatBilling': 'Seat billing',
  'desktop.managePlan': 'Manage plan',
  'team.access': 'Team Access',
  'team.accessSummary': 'Team access summary',
  'team.jitActive': 'JIT active',
  'team.auditEvents': 'Audit events',
  'team.review': 'Review',
  'team.sharedVault': 'Shared Vault',
  'team.pending': 'pending',
  'team.memberRoles': 'Member Roles',
  'team.auditTrail': 'Audit Trail',
  'team.accessReview': 'Access review',
  'team.accessRequestStatus': 'Access request status',
  'team.approve': 'Approve',
  'team.reject': 'Reject',
  'team.reviewedBy': 'Reviewed by {reviewer}',
  'team.statusApproved': 'Approved',
  'team.statusRejected': 'Rejected',
  'team.statusRecording': 'Recording',
  'team.vaultProductionSsh': 'Production SSH',
  'team.vaultProductionSshScope': '18 hosts',
  'team.vaultProductionSshOwners': 'SRE leads',
  'team.vaultDatabaseBreakGlass': 'Database break-glass',
  'team.vaultDatabaseBreakGlassScope': '4 clusters',
  'team.vaultDatabaseBreakGlassOwners': 'Data platform',
  'team.vaultCiDeployKeys': 'CI deploy keys',
  'team.vaultCiDeployKeysScope': '12 runners',
  'team.vaultCiDeployKeysOwners': 'Release ops',
  'team.roleIncidentCommander': 'Incident commander',
  'team.roleSreReviewer': 'SRE reviewer',
  'team.roleReadOnlyObserver': 'Read-only observer',
  'team.accessJitActive': 'JIT active',
  'team.accessApprover': 'Approver',
  'team.accessSessionView': 'Session view',
  'team.auditJitRoleIssued': 'JIT role issued',
  'team.auditVaultShareApproved': 'Vault share approved',
  'team.auditCommandRecorded': 'Command recorded',
  'team.auditAccessRequestApproved': 'Access request approved',
  'team.auditAccessRequestRejected': 'Access request rejected',
  'team.productionElevation': 'Production elevation',
  'team.productionElevationDetail': 'Incident commander role for gateway triage',
};

function t(key: TranslationKey, values?: Record<string, string | number>) {
  let template = messages[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    template = template.replaceAll(`{${name}}`, String(value));
  }
  return template;
}

const activeConnection = {
  color: 'good' as const,
  group: 'Production',
  host: '10.48.12.11',
  latencyHistory: [32, 29, 35, 27, 30, 26, 28],
  latencyMs: 28,
  name: 'prod-edge-01',
  status: 'online',
  tags: ['gateway', 'ssh'],
};
const inspectorConnectionStats = {
  averageLatencyMs: 37,
  onlineConnections: 6,
  totalConnections: 8,
};
const inspectorSessionContext = {
  regionLabel: 'us-east / edge',
  userHandle: 'lin.chen',
};

describe('panel event handlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders InspectorPanel content immediately without an artificial loading delay', () => {
    render(
      <InspectorPanel
        activeConnection={activeConnection}
        connectionStats={inspectorConnectionStats}
        formatters={formatters}
        sessionContext={inspectorSessionContext}
        t={t}
      />,
    );

    expect(document.querySelector('.skeleton--card')).toBeNull();
    expect(screen.getByText('prod-edge-01')).toBeTruthy();
    expect(screen.getByText('10.48.12.11')).toBeTruthy();
    expect(screen.getByText('Production group')).toBeTruthy();
    expect(screen.getByText('lin.chen')).toBeTruthy();
    expect(screen.getByText('us-east / edge')).toBeTruthy();
  });

  it('toggles team access review visibility on button click', async () => {
    render(<TeamAccessPanel formatters={formatters} t={t} />);

    const reviewButtons = screen.getAllByText('Review');
    const reviewButton = reviewButtons[0];
    expect(document.getElementById('team-access-review')).toBeNull();

    await act(async () => {
      fireEvent.click(reviewButton);
    });

    expect(document.getElementById('team-access-review')).toBeTruthy();
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Reject')).toBeTruthy();
  });

  it('handles approve decision and updates request status', async () => {
    render(<TeamAccessPanel formatters={formatters} t={t} />);

    await act(async () => {
      fireEvent.click(screen.getAllByText('Review')[0]);
    });

    const approveButton = screen.getByText('Approve');
    await act(async () => {
      fireEvent.click(approveButton);
    });

    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
  });

  it('handles reject decision and updates request status', async () => {
    render(<TeamAccessPanel formatters={formatters} t={t} />);

    await act(async () => {
      fireEvent.click(screen.getAllByText('Review')[0]);
    });

    const rejectButton = screen.getByText('Reject');
    await act(async () => {
      fireEvent.click(rejectButton);
    });

    expect(screen.getAllByText('Rejected').length).toBeGreaterThanOrEqual(1);
  });

  it('exports connections as JSON blob on button click', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    });

    render(<SettingsPanel t={t} />);

    const exportButton = screen.getByText('Export connections');
    await act(async () => {
      fireEvent.click(exportButton);
    });

    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('imports connections from file input change event', async () => {
    const readAsTextSpy = vi.fn();

    class MockFileReader {
      onload: ((ev: unknown) => void) | null = null;
      result = '{"connections":[]}';
      readAsText = readAsTextSpy.mockImplementation(() => {
        if (this.onload) {
          this.onload({ target: this });
        }
      });
    }

    vi.stubGlobal('FileReader', MockFileReader);

    render(<SettingsPanel t={t} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    // Also verify the import button click triggers the hidden file input
    const importButton = screen.getByText('Import connections');
    const clickSpy = vi.spyOn(fileInput, 'click');
    await act(async () => {
      fireEvent.click(importButton);
    });
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();

    const file = new File(['{"connections":[]}'], 'connections.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file] });

    await act(async () => {
      fireEvent.change(fileInput);
    });

    expect(readAsTextSpy).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('toggles telemetry consent from settings', async () => {
    const onChange = vi.fn();
    render(<SettingsPanel t={t} telemetry={{ available: true, enabled: false, onChange }} />);

    const checkbox = screen.getByLabelText(/Error telemetry/) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await act(async () => {
      fireEvent.click(checkbox);
    });

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('handles file input change with no files selected', async () => {
    render(<SettingsPanel t={t} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    // Trigger change event with empty files list
    Object.defineProperty(fileInput, 'files', { value: [] });

    await act(async () => {
      fireEvent.change(fileInput);
    });

    // Should not throw — early return on no file
  });
});
