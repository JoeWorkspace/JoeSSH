export type ConnectionTarget = {
  host: string;
  port?: number;
  username?: string;
};

export function formatConnectionTarget(target: ConnectionTarget): string {
  const host = target.host.includes(":") ? `[${target.host}]` : target.host;
  const destination = target.username ? `${target.username}@${host}` : host;
  return target.port === undefined ? destination : `${destination}:${target.port}`;
}

export function splitConnectionTarget(target: string): ConnectionTarget {
  const trimmedTarget = target.trim();
  if (trimmedTarget.startsWith("ssh://")) {
    try {
      const url = new URL(trimmedTarget);
      const host = stripIpv6Brackets(url.hostname);
      if (!host) {
        return { host: target };
      }
      return {
        host,
        port: parsePort(url.port),
        username: url.username ? decodeURIComponent(url.username) : undefined,
      };
    } catch {
      return { host: target };
    }
  }

  const separatorIndex = trimmedTarget.indexOf("@");
  if (separatorIndex > 0 && separatorIndex < trimmedTarget.length - 1) {
    const parsedHost = parseHostAndPort(trimmedTarget.slice(separatorIndex + 1));
    return {
      ...parsedHost,
      username: trimmedTarget.slice(0, separatorIndex),
    };
  }

  return parseHostAndPort(trimmedTarget || target);
}

function parseHostAndPort(value: string): ConnectionTarget {
  const bracketMatch = value.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketMatch) {
    return {
      host: bracketMatch[1],
      port: parsePort(bracketMatch[2]),
    };
  }

  const hostPortMatch = value.match(/^([^:]+):(\d+)$/);
  if (hostPortMatch) {
    return {
      host: hostPortMatch[1],
      port: parsePort(hostPortMatch[2]),
    };
  }

  return { host: value };
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  // Keep explicit ports, including invalid values, for the connection form to
  // reject. Dropping an invalid port silently redirects the request to port 22.
  return Number(value);
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}
