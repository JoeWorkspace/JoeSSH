import type { LocaleFormatters } from '@atlasterm/i18n';
import type {
  DeviceStatus,
  MemberStatus,
  RoleRisk,
} from './adminData';
import type { LocalMessageKey, createWebTranslator } from './localization';

export function getDeviceStatusMeta(status: DeviceStatus): { className?: string; key: LocalMessageKey; stableText: string } {
  if (status === 'catching_up') {
    return { className: 'pendingStatus', key: 'web.status.catchingUp', stableText: 'Catching up' };
  }

  if (status === 'current') {
    return { key: 'web.status.current', stableText: 'Current' };
  }

  if (status === 'degraded') {
    return { className: 'warningStatus', key: 'web.status.degraded', stableText: 'Degraded' };
  }

  return { className: 'warningStatus', key: 'web.status.offline', stableText: 'Offline' };
}

export function getMemberStatusMeta(status: MemberStatus): { className?: string; key: LocalMessageKey } {
  if (status === 'invited') {
    return { className: 'pendingStatus', key: 'web.status.invited' };
  }

  if (status === 'suspended') {
    return { className: 'warningStatus', key: 'web.status.suspended' };
  }

  return { key: 'web.status.active' };
}

export function getRoleRiskMeta(risk: RoleRisk): { className?: string; key: LocalMessageKey } {
  if (risk === 'limited') {
    return { className: 'neutralStatus', key: 'web.risk.limited' };
  }

  return { className: 'warningStatus', key: risk === 'full' ? 'web.risk.full' : 'web.risk.elevated' };
}

export function getRoleMessageKey(role: string): LocalMessageKey | undefined {
  return matchKnownValue(role, {
    operator: 'web.role.operator',
    'support viewer': 'web.role.supportViewer',
    'workspace admin': 'web.role.workspaceAdmin',
  });
}

export function getScopeMessageKey(scope: string): LocalMessageKey | undefined {
  return matchKnownValue(scope, {
    'devices, sessions, audit read': 'web.scope.operator',
    'members, roles, sync policy': 'web.scope.admin',
    'read-only dashboard access': 'web.scope.viewer',
  });
}

export function getAuditActionKey(action: string): LocalMessageKey | undefined {
  return matchKnownValue(action, {
    'accepted 12 profile changes': 'web.event.profileChanges',
    'blocked export from unmanaged device': 'web.event.exportBlocked',
    'changed jordan lee role': 'web.event.roleChanged',
    'issued fresh cursor': 'web.event.freshCursor',
  });
}

export function getAuditTargetKey(target: string): LocalMessageKey | undefined {
  return matchKnownValue(target, {
    'support viewer': 'web.target.supportViewer',
    'unknown browser': 'web.target.unknownBrowser',
  });
}

export function matchKnownValue(value: string, map: Partial<Record<string, LocalMessageKey>>): LocalMessageKey | undefined {
  return map[value.trim().toLowerCase()];
}

export function formatLastSeen(value: string, formatters: LocaleFormatters, t: ReturnType<typeof createWebTranslator>) {
  if (value === 'Live') {
    return t.local('web.status.live');
  }

  const relativeMatch = value.match(/^(\d+)\s+(min|hr)\s+ago$/i);

  if (!relativeMatch) {
    // Live mode returns ISO/RFC3339 timestamps; avoid JavaScript's lenient parsing for arbitrary labels.
    if (isIsoDateTime(value)) {
      try {
        return formatters.time(value, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      } catch {
        return value;
      }
    }
    return value;
  }

  const amount = Number(relativeMatch[1]);
  const unit = relativeMatch[2].toLowerCase() === 'hr' ? 'hour' : 'minute';

  return formatters.relativeTime(-amount, unit);
}

export function formatClockTime(value: string, formatters: LocaleFormatters) {
  const clockTime = parseClockTime(value);
  const timeOptions = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  } satisfies Intl.DateTimeFormatOptions;

  if (clockTime) {
    return formatters.time(Date.UTC(2026, 4, 24, clockTime.hour, clockTime.minute), timeOptions);
  }

  if (/^\d{1,2}:\d{2}$/.test(value)) {
    return value;
  }

  if (isIsoDateTime(value)) {
    try {
      return formatters.time(value, timeOptions);
    } catch {
      return value;
    }
  }

  return value;
}

export function getClockDateTime(value: string) {
  const clockTime = parseClockTime(value);

  if (clockTime) {
    return clockTime.dateTime;
  }

  if (isIsoDateTime(value) && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  return undefined;
}

function parseClockTime(value: string) {
  const clockMatch = value.match(/^(\d{1,2}):(\d{2})$/);

  if (!clockMatch) {
    return undefined;
  }

  const [, hour, minute] = clockMatch;
  const hourValue = Number(hour);
  const minuteValue = Number(minute);

  if (hourValue < 0 || hourValue > 23 || minuteValue < 0 || minuteValue > 59) {
    return undefined;
  }

  return {
    dateTime: `${hourValue.toString().padStart(2, '0')}:${minute}`,
    hour: hourValue,
    minute: minuteValue,
  };
}

function isIsoDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}
