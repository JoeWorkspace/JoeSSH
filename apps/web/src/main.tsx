import "./sw-register";
import {
  createErrorMonitor,
  createNoopErrorMonitor,
  getBrowserTelemetryConsentStorage,
  isTelemetryOptedIn,
  readTelemetryConsent,
  writeTelemetryConsent,
} from "@atlasterm/error-monitor";
import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Activity,
  Cloud,
  Database,
  FileClock,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UsersRound,
} from 'lucide-react';
import { SUPPORTED_LOCALES, createLocaleFormatters, type AtlasLocale, type LocaleFormatters } from '@atlasterm/i18n';
import {
  AdminDataError,
  type AdminDashboardSnapshot,
  type AuditEvent,
  type DeviceRecord,
  type MemberRecord,
  type RoleRecord,
  type AdminSnapshotSourceDescriptor,
  getAdminSnapshotSourceDescriptor,
  loadAdminDashboard,
} from './adminData';
import { fixtureAdminSnapshot } from './adminData.fixture';
import {
  type LanguageChoice,
  type LocalMessageKey,
  applyDocumentLocale,
  createWebTranslator,
  createWebTranslatorAsync,
  getInitialLanguageChoice,
  persistLanguageChoice,
  resolveLanguageChoice,
} from './localization';
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
} from './helpers';
import { WebErrorBoundary } from './WebErrorBoundary';
import './styles.css';
import './admin-theme.css';

type AdminSnapshotMeta = AdminSnapshotSourceDescriptor & {
  refreshedAt: string;
};
type AdminDashboardPendingPhase = 'authRequired' | 'empty' | 'error' | 'loading';
type AdminDashboardPendingState = {
  lastSuccess?: AdminSnapshotMeta;
  phase: AdminDashboardPendingPhase;
  sourceDescriptor: AdminSnapshotSourceDescriptor;
};
type AdminDashboardState =
  | AdminDashboardPendingState
  | { phase: 'ready'; meta: AdminSnapshotMeta; snapshot: AdminDashboardSnapshot };
type AdminDashboardNonReadyState = AdminDashboardPendingState;
type WebTranslator = ReturnType<typeof createWebTranslator>;
type TelemetryControls = {
  available: boolean;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};
const adminNavSections = ['sync', 'devices', 'team', 'audit', 'storage'] as const;
type AdminNavSection = (typeof adminNavSections)[number];

function getActiveAdminNavSection(): AdminNavSection {
  if (typeof window === 'undefined') {
    return 'sync';
  }

  const hashSection = window.location.hash.replace(/^#/, '');
  return adminNavSections.includes(hashSection as AdminNavSection) ? (hashSection as AdminNavSection) : 'sync';
}

function createInitialAdminDashboardState(): AdminDashboardState {
  const sourceDescriptor = getAdminSnapshotSourceDescriptor();

  if (sourceDescriptor.mode === 'live') {
    return { phase: 'loading', sourceDescriptor };
  }

  return {
    meta: createAdminSnapshotMeta(sourceDescriptor),
    phase: 'ready',
    snapshot: fixtureAdminSnapshot,
  };
}

function createAdminSnapshotMeta(sourceDescriptor: AdminSnapshotSourceDescriptor): AdminSnapshotMeta {
  return {
    ...sourceDescriptor,
    refreshedAt: new Date().toISOString(),
  };
}

function getDashboardLastSuccess(state: AdminDashboardState): AdminSnapshotMeta | undefined {
  return state.phase === 'ready' ? state.meta : state.lastSuccess;
}

function App({
  languageChoice,
  locale,
  onLanguageChoiceChange,
  telemetry,
  t,
}: {
  languageChoice: LanguageChoice;
  locale: AtlasLocale;
  onLanguageChoiceChange: (choice: LanguageChoice) => void;
  telemetry: TelemetryControls;
  t: WebTranslator;
}) {
  const [dashboardState, setDashboardState] = React.useState<AdminDashboardState>(() =>
    createInitialAdminDashboardState(),
  );
  const formatters = React.useMemo(() => createLocaleFormatters(locale), [locale]);
  const [activeNavSection, setActiveNavSection] = React.useState<AdminNavSection>(getActiveAdminNavSection);
  const refreshTokenRef = React.useRef(0);
  const refreshAbortRef = React.useRef<AbortController | null>(null);
  const dashboardStateRef = React.useRef(dashboardState);
  dashboardStateRef.current = dashboardState;

  const refreshDashboard = React.useCallback(async () => {
    const requestToken = ++refreshTokenRef.current;
    const sourceDescriptor = getAdminSnapshotSourceDescriptor();
    const lastSuccess = getDashboardLastSuccess(dashboardStateRef.current);
    refreshAbortRef.current?.abort();

    if (sourceDescriptor.mode !== 'live') {
      refreshAbortRef.current = null;
      setDashboardState({
        meta: createAdminSnapshotMeta(sourceDescriptor),
        phase: 'ready',
        snapshot: fixtureAdminSnapshot,
      });
      return;
    }

    const abortController = new AbortController();
    refreshAbortRef.current = abortController;
    setDashboardState({ lastSuccess, phase: 'loading', sourceDescriptor });

    try {
      const snapshot = await loadAdminDashboard(window.fetch.bind(window), sourceDescriptor.snapshotUrl, {
        signal: abortController.signal,
      });
      if (requestToken !== refreshTokenRef.current) return;
      setDashboardState({
        meta: createAdminSnapshotMeta(sourceDescriptor),
        phase: 'ready',
        snapshot,
      });
    } catch (error) {
      if (requestToken !== refreshTokenRef.current) return;
      const adminErrorCode = error instanceof AdminDataError ? error.code : 'unknown';

      setDashboardState({
        lastSuccess,
        phase:
          adminErrorCode === 'auth_required'
            ? 'authRequired'
            : adminErrorCode === 'empty'
              ? 'empty'
              : 'error',
        sourceDescriptor,
      });
    } finally {
      if (refreshAbortRef.current === abortController) {
        refreshAbortRef.current = null;
      }
    }
  }, []);

  React.useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  React.useEffect(() => {
    const syncActiveNavSection = () => setActiveNavSection(getActiveAdminNavSection());

    syncActiveNavSection();
    window.addEventListener('hashchange', syncActiveNavSection);
    return () => window.removeEventListener('hashchange', syncActiveNavSection);
  }, []);

  React.useEffect(() => {
    if (getAdminSnapshotSourceDescriptor().mode === 'live') {
      void refreshDashboard();
    }
  }, [refreshDashboard]);

  React.useEffect(() => {
    return () => {
      refreshTokenRef.current += 1;
      refreshAbortRef.current?.abort();
      refreshAbortRef.current = null;
    };
  }, []);

  function handleLanguageChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const choice = event.target.value as LanguageChoice;
    onLanguageChoiceChange(choice);
  }

  function handleTelemetryChange(event: React.ChangeEvent<HTMLInputElement>) {
    telemetry.onChange(event.currentTarget.checked);
  }

  function getNavItemClassName(section: AdminNavSection) {
    return activeNavSection === section ? 'navItem active' : 'navItem';
  }

  const isDashboardLoading = dashboardState.phase === 'loading';

  return (
    <div className="shell">
      <a className="skipLink" href="#main-content">
        {t.shared('web.skipToContent')}
      </a>
      <header className="sidebar">
        <div className="brand">
          <Cloud size={24} aria-hidden="true" />
          <span>JoeSSH</span>
        </div>
        <nav aria-labelledby="admin-navigation-title">
          <h2 className="visuallyHidden" id="admin-navigation-title">{t.shared('web.adminNavigation')}</h2>
          <a className={getNavItemClassName('sync')} href="#sync" aria-current={activeNavSection === 'sync' ? 'location' : undefined}>
            <Activity size={18} aria-hidden="true" />
            {t.local('web.nav.sync')}
          </a>
          <a className={getNavItemClassName('devices')} href="#devices" aria-current={activeNavSection === 'devices' ? 'location' : undefined}>
            <Smartphone size={18} aria-hidden="true" />
            {t.local('web.nav.devices')}
          </a>
          <a className={getNavItemClassName('team')} href="#team" aria-current={activeNavSection === 'team' ? 'location' : undefined}>
            <UsersRound size={18} aria-hidden="true" />
            {t.local('web.nav.team')}
          </a>
          <a className={getNavItemClassName('audit')} href="#audit" aria-current={activeNavSection === 'audit' ? 'location' : undefined}>
            <FileClock size={18} aria-hidden="true" />
            {t.local('web.nav.audit')}
          </a>
          <a className={getNavItemClassName('storage')} href="#storage" aria-current={activeNavSection === 'storage' ? 'location' : undefined}>
            <Database size={18} aria-hidden="true" />
            {t.local('web.nav.storage')}
          </a>
        </nav>
      </header>

      <main
        className="workspace"
        id="main-content"
        aria-busy={isDashboardLoading}
        aria-labelledby="admin-workspace-title"
        tabIndex={-1}
      >
        <header className="topbar">
          <div>
            <p className="eyebrow">{t.shared('web.adminConsole')}</p>
            <h1 id="admin-workspace-title">{t.shared('web.teamOperations')}</h1>
          </div>
          <div className="topbarActions">
            <LanguageSelector
              currentLocale={locale}
              languageChoice={languageChoice}
              onChange={handleLanguageChange}
              t={t}
            />
            <label
              className="telemetryToggle"
              title={
                telemetry.available
                  ? t.shared('desktop.telemetryPrivacyHint')
                  : t.shared('web.telemetryUnavailable')
              }
            >
              <span>{t.shared('web.telemetryErrors')}</span>
              <input
                checked={telemetry.enabled}
                disabled={!telemetry.available}
                onChange={handleTelemetryChange}
                type="checkbox"
              />
            </label>
            <button
              className="iconButton"
              type="button"
              aria-busy={isDashboardLoading ? true : undefined}
              aria-describedby={isDashboardLoading ? 'admin-refresh-status' : undefined}
              data-loading={isDashboardLoading ? 'true' : undefined}
              title={t.shared('web.refreshTeamDashboard')}
              onClick={() => void refreshDashboard()}
            >
              <RefreshCw size={20} aria-hidden="true" />
              <span className="visuallyHidden">{t.shared('web.refreshTeamDashboard')}</span>
            </button>
            {isDashboardLoading ? (
              <span className="visuallyHidden" id="admin-refresh-status">
                {t.local('web.state.loading.label')}
              </span>
            ) : null}
          </div>
        </header>

        <DashboardContent formatters={formatters} state={dashboardState} t={t} />
      </main>
    </div>
  );
}

const DashboardContent = React.memo(function DashboardContent({
  formatters,
  state,
  t,
}: {
  formatters: LocaleFormatters;
  state: AdminDashboardState;
  t: ReturnType<typeof createWebTranslator>;
}) {
  if (state.phase !== 'ready') {
    return (
      <>
        <AdminSnapshotStatusBar formatters={formatters} state={state} t={t} />
        <DashboardStatePanel formatters={formatters} state={state} t={t} />
      </>
    );
  }

  const { meta, snapshot } = state;

  return (
    <>
      <AdminSnapshotStatusBar formatters={formatters} state={state} t={t} />
      <h2 className="visuallyHidden" id="admin-metrics-title">{t.shared('web.teamMetrics')}</h2>
      <div className="metrics" id="sync" role="list" aria-labelledby="admin-metrics-title">
        <Metric icon={<UsersRound size={22} />} label={t.shared('web.activeMembers')} value={formatters.number(snapshot.metrics.activeMembers)} />
        <Metric icon={<KeyRound size={22} />} label={t.shared('web.rolesConfigured')} value={formatters.number(snapshot.metrics.rolesConfigured)} />
        <Metric icon={<ShieldCheck size={22} />} label={t.shared('web.healthyDevices')} value={formatters.number(snapshot.metrics.healthyDevices)} />
        <Metric icon={<Activity size={22} />} label={t.shared('web.auditEventsToday')} value={formatters.number(snapshot.metrics.auditEventsToday)} />
      </div>

      <section className="dashboardGrid" id="team" aria-labelledby="admin-team-overview-title">
        <h2 className="visuallyHidden" id="admin-team-overview-title">{t.shared('web.teamOverview')}</h2>
        <section className="panel" aria-labelledby="admin-members-title" aria-describedby="admin-members-source">
          <div className="panelHeader">
            <h2 id="admin-members-title">{t.shared('web.members')}</h2>
            <span id="admin-members-source">
              {t.local(meta.source === 'live' ? 'web.source.live' : 'web.source.fixture')}
            </span>
          </div>
          <h3 className="visuallyHidden" id="admin-members-table-title">{t.local('web.table.teamMembers')}</h3>
          <div className="table memberTable" role="table" aria-labelledby="admin-members-table-title" aria-colcount={4} aria-rowcount={snapshot.members.length + 1}>
            <div className="row headerRow" role="row" aria-rowindex={1}>
              <span role="columnheader" aria-colindex={1}>{t.shared('web.member')}</span>
              <span role="columnheader" aria-colindex={2}>{t.shared('web.role')}</span>
              <span role="columnheader" aria-colindex={3}>{t.shared('web.status')}</span>
              <span role="columnheader" aria-colindex={4}>{t.shared('web.devices')}</span>
            </div>
            {snapshot.members.map((member, index) => (
              <MemberRow formatters={formatters} key={member.id} member={member} rowIndex={index + 2} t={t} />
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="admin-roles-title" aria-describedby="admin-roles-summary">
          <div className="panelHeader">
            <h2 id="admin-roles-title">{t.shared('web.roles')}</h2>
            <span id="admin-roles-summary">{t.shared('web.accessModel')}</span>
          </div>
          <h3 className="visuallyHidden" id="admin-role-permissions-title">{t.shared('web.rolePermissions')}</h3>
          <div className="roleList" role="list" aria-labelledby="admin-role-permissions-title">
            {snapshot.roles.map((role) => (
              <RoleItem formatters={formatters} key={role.id} role={role} t={t} />
            ))}
          </div>
        </section>
      </section>

      <DeviceTable devices={snapshot.devices} formatters={formatters} t={t} />
      <AuditLog events={snapshot.auditEvents} formatters={formatters} t={t} />
    </>
  );
});

const AdminSnapshotStatusBar = React.memo(function AdminSnapshotStatusBar({
  formatters,
  state,
  t,
}: {
  formatters: LocaleFormatters;
  state: AdminDashboardState;
  t: ReturnType<typeof createWebTranslator>;
}) {
  const statusTitleId = React.useId();
  const sourceDescriptor = state.phase === 'ready' ? state.meta : state.sourceDescriptor;
  const lastSuccess = getDashboardLastSuccess(state);
  const healthKey = getAdminSnapshotHealthKey(state.phase);
  const sourceLabel =
    state.phase === 'ready'
      ? t.local(sourceDescriptor.source === 'live' ? 'web.source.live' : 'web.source.fixture')
      : t.local(healthKey);
  const endpointLabel =
    sourceDescriptor.snapshotUrl === null ? t.local('web.snapshot.fixtureEndpoint') : sourceDescriptor.snapshotUrl;
  const refreshedAt = state.phase === 'ready' ? state.meta.refreshedAt : lastSuccess?.refreshedAt;

  return (
    <section className="snapshotStatus" aria-labelledby={statusTitleId}>
      <h2 className="visuallyHidden" id={statusTitleId}>{t.local('web.snapshot.status')}</h2>
      <dl>
        <div>
          <dt>{t.local('web.snapshot.status')}</dt>
          <dd>
            <mark className={getAdminSnapshotHealthClassName(state.phase)}>
              {t.local(healthKey)}
            </mark>
          </dd>
        </div>
        <div>
          <dt>{t.local('web.snapshot.mode')}</dt>
          <dd>{sourceLabel}</dd>
        </div>
        <div>
          <dt>{t.local('web.snapshot.endpoint')}</dt>
          <dd className="snapshotEndpoint">{endpointLabel}</dd>
        </div>
        <div>
          <dt>{state.phase === 'ready' ? t.local('web.snapshot.lastRefreshed') : t.local('web.snapshot.lastSuccess')}</dt>
          <dd>
            {refreshedAt ? (
              <time dateTime={refreshedAt}>{formatSnapshotDateTime(refreshedAt, formatters)}</time>
            ) : (
              t.local('web.snapshot.notRefreshed')
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
});

const DashboardStatePanel = React.memo(function DashboardStatePanel({
  formatters,
  state,
  t,
}: {
  formatters: LocaleFormatters;
  state: AdminDashboardNonReadyState;
  t: ReturnType<typeof createWebTranslator>;
}) {
  const panelRef = React.useRef<HTMLElement>(null);
  const stateCopyByPhase: Record<
    AdminDashboardNonReadyState['phase'],
    { labelKey: LocalMessageKey; message: string; titleKey: LocalMessageKey }
  > = {
    authRequired: {
      labelKey: 'web.state.auth.label',
      message: t.local('web.state.auth.message'),
      titleKey: 'web.state.auth.title',
    },
    empty: {
      labelKey: 'web.state.empty.label',
      message: t.local('web.state.empty.message'),
      titleKey: 'web.state.empty.title',
    },
    error: {
      labelKey: 'web.state.error.label',
      message: t.local('web.state.error.message'),
      titleKey: 'web.state.error.title',
    },
    loading: {
      labelKey: 'web.state.loading.label',
      message: t.local('web.state.loading.message'),
      titleKey: 'web.state.loading.title',
    },
  };
  const stateCopy = stateCopyByPhase[state.phase];

  const label = t.local(stateCopy.labelKey);
  const title = t.local(stateCopy.titleKey);
  const liveMode = state.phase === 'error' ? 'assertive' : 'polite';
  const labelId = React.useId();
  const titleId = React.useId();
  const messageId = React.useId();
  const stateRole = state.phase === 'error' ? 'alert' : 'status';

  React.useEffect(() => {
    if (state.phase !== 'loading') {
      panelRef.current?.focus();
    }
  }, [state.phase]);

  return (
    <section className="statePanel" role={stateRole} aria-labelledby={`${labelId} ${titleId}`} aria-describedby={messageId} aria-live={liveMode} aria-atomic="true" tabIndex={-1} ref={panelRef}>
      <span className="stateBadge" id={labelId}>{label}</span>
      <h2 id={titleId}>{title}</h2>
      <p id={messageId}>{stateCopy.message}</p>
      {state.lastSuccess ? (
        <p className="statePanelMeta">
          {t.local('web.snapshot.lastSuccess')}:{' '}
          <time dateTime={state.lastSuccess.refreshedAt}>
            {formatSnapshotDateTime(state.lastSuccess.refreshedAt, formatters)}
          </time>
        </p>
      ) : null}
    </section>
  );
});

function getAdminSnapshotHealthKey(phase: AdminDashboardState['phase']): LocalMessageKey {
  if (phase === 'ready') {
    return 'web.snapshot.health.ready';
  }

  if (phase === 'loading') {
    return 'web.snapshot.health.loading';
  }

  if (phase === 'authRequired') {
    return 'web.snapshot.health.authRequired';
  }

  if (phase === 'empty') {
    return 'web.snapshot.health.empty';
  }

  return 'web.snapshot.health.error';
}

function getAdminSnapshotHealthClassName(phase: AdminDashboardState['phase']) {
  if (phase === 'ready') {
    return undefined;
  }

  if (phase === 'loading' || phase === 'empty') {
    return 'pendingStatus';
  }

  return 'warningStatus';
}

function formatSnapshotDateTime(value: string, formatters: LocaleFormatters) {
  try {
    return formatters.dateTime(value, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  } catch {
    return value;
  }
}

const MemberRow = React.memo(function MemberRow({
  formatters,
  member,
  rowIndex,
  t,
}: {
  formatters: LocaleFormatters;
  member: MemberRecord;
  rowIndex: number;
  t: ReturnType<typeof createWebTranslator>;
}) {
  const roleKey = getRoleMessageKey(member.role);
  const status = getMemberStatusMeta(member.status);
  const roleLabel = roleKey ? t.local(roleKey) : member.role;
  const statusLabel = t.local(status.key);
  const deviceCountLabel = formatters.number(member.deviceCount);
  const rowLabelPrefix = React.useId();
  const nameId = `${rowLabelPrefix}-name`;
  const emailId = `${rowLabelPrefix}-email`;
  const roleId = `${rowLabelPrefix}-role`;
  const statusId = `${rowLabelPrefix}-status`;
  const deviceCountId = `${rowLabelPrefix}-devices`;

  return (
    <div className="row" role="row" aria-rowindex={rowIndex} aria-labelledby={`${nameId} ${emailId} ${roleId} ${statusId} ${deviceCountId}`}>
      <span role="rowheader" aria-colindex={1} data-label={t.shared('web.member')}>
        <strong id={nameId}>{member.name}</strong>
        <small id={emailId}>{member.email}</small>
      </span>
      <span id={roleId} role="cell" aria-colindex={2} data-label={t.shared('web.role')}>
        {roleLabel}
      </span>
      <span role="cell" aria-colindex={3} data-label={t.shared('web.status')}>
        <mark id={statusId} className={status.className}>
          {statusLabel}
        </mark>
      </span>
      <span id={deviceCountId} role="cell" aria-colindex={4} data-label={t.shared('web.devices')}>{deviceCountLabel}</span>
    </div>
  );
});

const RoleItem = React.memo(function RoleItem({
  formatters,
  role,
  t,
}: {
  formatters: LocaleFormatters;
  role: RoleRecord;
  t: ReturnType<typeof createWebTranslator>;
}) {
  const nameKey = getRoleMessageKey(role.name);
  const scopeKey = getScopeMessageKey(role.scope);
  const risk = getRoleRiskMeta(role.risk);
  const nameId = React.useId();
  const scopeId = React.useId();
  const memberCountId = React.useId();
  const riskId = React.useId();

  return (
    <div className="roleItem" role="listitem" aria-labelledby={`${nameId} ${scopeId} ${memberCountId} ${riskId}`}>
      <div>
        <strong id={nameId}>{nameKey ? t.local(nameKey) : role.name}</strong>
        <span id={scopeId}>
          {scopeKey ? t.local(scopeKey) : role.scope}
          <small className="stableText" aria-hidden="true">{role.scope}</small>
        </span>
      </div>
      <div className="roleMeta">
        <span id={memberCountId}>
          {formatters.number(role.memberCount)} {t.local(role.memberCount === 1 ? 'web.memberCount.one' : 'web.memberCount.other')}
        </span>
        <mark id={riskId} className={risk.className}>{t.local(risk.key)}</mark>
      </div>
    </div>
  );
});

const DeviceTable = React.memo(function DeviceTable({
  devices,
  formatters,
  t,
}: {
  devices: DeviceRecord[];
  formatters: LocaleFormatters;
  t: ReturnType<typeof createWebTranslator>;
}) {
  const rowLabelPrefix = React.useId();

  return (
    <section className="panel" id="devices" data-storage-target="true" aria-labelledby="admin-device-status-title" aria-describedby="admin-device-status-summary">
      <div className="panelHeader">
        <h2 id="admin-device-status-title">{t.shared('web.deviceStatus')}</h2>
        <span id="admin-device-status-summary">{t.shared('web.managedEndpoints')}</span>
      </div>
      <h3 className="visuallyHidden" id="admin-storage-title">{t.local('web.nav.storage')}</h3>
      <h3 className="visuallyHidden" id="admin-managed-devices-title">{t.shared('web.managedDevices')}</h3>
      <div id="storage" className="table deviceTable" role="table" aria-labelledby="admin-storage-title admin-managed-devices-title" aria-colcount={6} aria-rowcount={devices.length + 1}>
        <div className="row headerRow" role="row" aria-rowindex={1}>
          <span role="columnheader" aria-colindex={1}>{t.shared('web.device')}</span>
          <span role="columnheader" aria-colindex={2}>{t.shared('web.owner')}</span>
          <span role="columnheader" aria-colindex={3}>{t.shared('web.platform')}</span>
          <span role="columnheader" aria-colindex={4}>{t.shared('web.cursor')}</span>
          <span role="columnheader" aria-colindex={5}>{t.shared('web.status')}</span>
          <span role="columnheader" aria-colindex={6}>{t.shared('web.lastSeen')}</span>
        </div>
        {devices.map((device, index) => {
          const status = getDeviceStatusMeta(device.status);
          const statusLabel = t.local(status.key);
          const lastSeenLabel = formatLastSeen(device.lastSeen, formatters, t);
          const nameId = `${rowLabelPrefix}-${index}-name`;
          const ownerId = `${rowLabelPrefix}-${index}-owner`;
          const platformId = `${rowLabelPrefix}-${index}-platform`;
          const cursorId = `${rowLabelPrefix}-${index}-cursor`;
          const statusId = `${rowLabelPrefix}-${index}-status`;
          const lastSeenId = `${rowLabelPrefix}-${index}-last-seen`;

          return (
            <div className="row" role="row" aria-rowindex={index + 2} aria-labelledby={`${nameId} ${ownerId} ${platformId} ${cursorId} ${statusId} ${lastSeenId}`} key={device.id}>
              <span id={nameId} role="rowheader" aria-colindex={1} data-label={t.shared('web.device')}>{device.name}</span>
              <span id={ownerId} role="cell" aria-colindex={2} data-label={t.shared('web.owner')}>{device.owner}</span>
              <span id={platformId} role="cell" aria-colindex={3} data-label={t.shared('web.platform')}>{device.platform}</span>
              <span id={cursorId} role="cell" aria-colindex={4} data-label={t.shared('web.cursor')}>{device.cursor}</span>
              <span role="cell" aria-colindex={5} data-label={t.shared('web.status')}>
                <mark id={statusId} className={status.className}>
                  {statusLabel}
                  <small className="stableText" aria-hidden="true">{status.stableText}</small>
                </mark>
              </span>
              <span id={lastSeenId} role="cell" aria-colindex={6} data-label={t.shared('web.lastSeen')}>
                {lastSeenLabel}
                <small className="stableText" aria-hidden="true">{device.lastSeen}</small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
});

const AuditLog = React.memo(function AuditLog({
  events,
  formatters,
  t,
}: {
  events: AuditEvent[];
  formatters: LocaleFormatters;
  t: ReturnType<typeof createWebTranslator>;
}) {
  return (
    <section className="panel" id="audit" aria-labelledby="admin-audit-log-title" aria-describedby="admin-audit-log-summary">
      <div className="panelHeader">
        <h2 id="admin-audit-log-title">{t.shared('web.auditLog')}</h2>
        <span id="admin-audit-log-summary">{t.shared('web.last60Minutes')}</span>
      </div>
      <h3 className="visuallyHidden" id="admin-recent-audit-events-title">{t.shared('web.recentAuditEvents')}</h3>
      <ul className="eventList" aria-labelledby="admin-recent-audit-events-title">
        {events.map((event) => (
          <AuditEventItem event={event} formatters={formatters} key={event.id} t={t} />
        ))}
      </ul>
    </section>
  );
});

const AuditEventItem = React.memo(function AuditEventItem({
  event,
  formatters,
  t,
}: {
  event: AuditEvent;
  formatters: LocaleFormatters;
  t: ReturnType<typeof createWebTranslator>;
}) {
  const actionKey = getAuditActionKey(event.action);
  const targetKey = getAuditTargetKey(event.target);
  const timeId = React.useId();
  const actorId = React.useId();
  const actionId = React.useId();
  const targetId = React.useId();

  return (
    <li aria-labelledby={`${timeId} ${actorId} ${actionId} ${targetId}`}>
      <time id={timeId} dateTime={getClockDateTime(event.time)}>{formatClockTime(event.time, formatters)}</time>
      <div>
        <strong id={actorId}>{event.actor}</strong>
        <span id={actionId}>
          {actionKey ? t.local(actionKey) : event.action}
          <small className="stableText" aria-hidden="true">{event.action}</small>
        </span>
      </div>
      <em id={targetId}>{targetKey ? t.local(targetKey) : event.target}</em>
    </li>
  );
});

const LanguageSelector = React.memo(function LanguageSelector({
  currentLocale,
  languageChoice,
  onChange,
  t,
}: {
  currentLocale: AtlasLocale;
  languageChoice: LanguageChoice;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  t: ReturnType<typeof createWebTranslator>;
}) {
  const currentMeta = SUPPORTED_LOCALES.find((locale) => locale.code === currentLocale);
  const languageLabelId = React.useId();
  const currentLanguageDescriptionId = React.useId();

  return (
    <label className="languagePicker">
      <span id={languageLabelId}>{t.shared('language.selectorLabel')}</span>
      <select
        value={languageChoice}
        onChange={onChange}
        aria-labelledby={languageLabelId}
        aria-describedby={currentLanguageDescriptionId}
      >
        <option value="auto">{t.shared('language.autoRegion')}</option>
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.nativeName} / {locale.englishName}
          </option>
        ))}
      </select>
      <small id={currentLanguageDescriptionId}>
        {t.local('web.language.currentPrefix')}: {currentMeta?.nativeName ?? currentLocale}
      </small>
    </label>
  );
});

const Metric = React.memo(function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const labelId = React.useId();
  const valueId = React.useId();

  return (
    <div className="metric" role="listitem" aria-labelledby={`${labelId} ${valueId}`}>
      <div className="metricIcon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <strong id={valueId}>{value}</strong>
        <span id={labelId}>{label}</span>
      </div>
    </div>
  );
});


function AppWithBoundary() {
  const [languageChoice, setLanguageChoice] = React.useState<LanguageChoice>(getInitialLanguageChoice);
  const [telemetryEnabled, setTelemetryEnabled] = React.useState(initialWebTelemetryEnabled);
  const locale = React.useMemo(() => resolveLanguageChoice(languageChoice), [languageChoice]);
  const t = useWebTranslator(locale);

  const handleLanguageChoiceChange = React.useCallback((choice: LanguageChoice) => {
    setLanguageChoice(choice);
    persistLanguageChoice(choice);
  }, []);

  React.useEffect(() => {
    if (!webTelemetryAvailable || !telemetryEnabled) {
      errorMonitor.disable();
      return undefined;
    }

    errorMonitor.enable();
    const uninstall = errorMonitor.install();

    return () => {
      uninstall?.();
      errorMonitor.disable();
    };
  }, [telemetryEnabled]);

  const handleTelemetryChange = React.useCallback((enabled: boolean) => {
    const nextEnabled = webTelemetryAvailable && enabled;
    writeTelemetryConsent(getBrowserTelemetryConsentStorage(), nextEnabled);
    setTelemetryEnabled(nextEnabled);
  }, []);

  return (
    <WebErrorBoundary
      errorMonitor={errorMonitor}
      messageLabel={t.local('web.error.boundary.message')}
      reloadLabel={t.local('web.error.boundary.reload')}
      titleLabel={t.local('web.error.boundary.title')}
    >
      <App
        languageChoice={languageChoice}
        locale={locale}
        onLanguageChoiceChange={handleLanguageChoiceChange}
        telemetry={{
          available: webTelemetryAvailable,
          enabled: telemetryEnabled,
          onChange: handleTelemetryChange,
        }}
        t={t}
      />
    </WebErrorBoundary>
  );
}

function useWebTranslator(locale: AtlasLocale): WebTranslator {
  const fallbackTranslator = React.useMemo(() => createWebTranslator(locale), [locale]);
  const [translatorState, setTranslatorState] = React.useState(() => ({
    locale,
    translator: fallbackTranslator,
  }));

  React.useEffect(() => {
    let cancelled = false;
    setTranslatorState({ locale, translator: fallbackTranslator });
    createWebTranslatorAsync(locale).then((translator) => {
      if (!cancelled) {
        setTranslatorState({ locale, translator });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fallbackTranslator, locale]);

  return translatorState.locale === locale ? translatorState.translator : fallbackTranslator;
}

const webEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const webTelemetryAvailable = isTelemetryOptedIn(webEnv.VITE_ATLASTERM_TELEMETRY_OPT_IN);
const initialWebTelemetryEnabled = webTelemetryAvailable && readTelemetryConsent(getBrowserTelemetryConsentStorage());
const errorMonitor = webTelemetryAvailable
  ? createErrorMonitor({
      app: 'web',
      endpoint: webEnv.VITE_ATLASTERM_ERROR_MONITOR_ENDPOINT,
      version: webEnv.VITE_ATLASTERM_APP_VERSION ?? '0.1.0-beta.9',
    })
  : createNoopErrorMonitor();

if (!initialWebTelemetryEnabled) {
  errorMonitor.disable();
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppWithBoundary />
  </React.StrictMode>,
);
