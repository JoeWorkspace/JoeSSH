import type { TranslationKey } from "@atlasterm/i18n";

const dangerousPatterns = [
  {
    pattern: "rm -rf /",
    reasonKey: "desktop.safetyReasonRmRoot",
    test: (command: string) =>
      /(?:^|[;&|]\s*)(?:sudo(?:\s+-\S+)*\s+)?(?:\/(?:usr\/)?s?bin\/)?rm\s+(?:(?:-(?=[a-z-]*r)(?=[a-z-]*f)[a-z-]*)|(?:(?:-[a-z]+\s+|--recursive\s+|--force\s+|--no-preserve-root\s+)*(?:--recursive|--force)(?:\s+(?:-[a-z]+|--recursive|--force|--no-preserve-root))*))(?:\s+--no-preserve-root)?\s+\/(?:\s|$|[;&|])/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo(?:\s+-\S+)*\s+)?(?:\/(?:usr\/)?s?bin\/)?rm\s+(?:(?:-(?=[a-z-]*r)(?=[a-z-]*f)[a-z-]*)|(?:(?:-[a-z]+\s+|--recursive\s+|--force\s+|--no-preserve-root\s+)*(?:--recursive|--force)(?:\s+(?:-[a-z]+|--recursive|--force|--no-preserve-root))*))\s+\/\*(?:\s|$|[;&|])/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo(?:\s+-\S+)*\s+)?(?:\/(?:usr\/)?s?bin\/)?rm\s+-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*\s+\/(?:\s|$|[;&|])/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo(?:\s+-\S+)*\s+)?(?:\/(?:usr\/)?s?bin\/)?rm\s+-[a-z]*f[a-z]*\s+-[a-z]*r[a-z]*\s+\/(?:\s|$|[;&|])/.test(command),
  },
  { pattern: "mkfs", reasonKey: "desktop.safetyReasonMkfs", test: (command: string) => /(?:^|[;&|]\s*)(?:sudo\s+)?mkfs(?:\.\w+)?(?:\s|$)/.test(command) },
  { pattern: ":(){:|:&};:", reasonKey: "desktop.safetyReasonForkBomb", test: (command: string) => /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(command) },
  { pattern: "dd if=", reasonKey: "desktop.safetyReasonRawDiskCopy", test: (command: string) => /(?:^|[;&|]\s*)(?:sudo\s+)?dd\s+.*\bif=/.test(command) },
  {
    pattern: "chmod 777 /",
    reasonKey: "desktop.safetyReasonChmodRoot",
    test: (command: string) =>
      /(?:^|[;&|]\s*)(?:sudo\s+)?chmod\s+(?:(?:-[a-z]+|--recursive)\s+)*777\s+(?:(?:-[a-z]+|--recursive)\s+)*\/(?:\s|$|[;&|])/.test(command),
  },
  {
    pattern: "tee /dev/sd*",
    reasonKey: "desktop.safetyReasonTeeBlockDevice",
    test: (command: string) => /(?:^|[;&|]\s*)(?:sudo\s+)?tee\s+(?:-\S+\s+)*\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+|hd[a-z]\d*|vd[a-z]\d*|mmcblk\d+)(?:\s|$|[;&|])/.test(command),
  },
  {
    pattern: "> /dev/sd*",
    reasonKey: "desktop.safetyReasonRedirectBlockDevice",
    test: (command: string) => />\s*\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+|hd[a-z]\d*|vd[a-z]\d*|mmcblk\d+)(?:\s|$|[;&|])/.test(command),
  },
  {
    pattern: "find / -delete",
    reasonKey: "desktop.safetyReasonFindRootDelete",
    test: (command: string) =>
      /(?:^|[;&|]\s*)(?:sudo\s+)?find\s+\/(?:\s|bin|boot|dev|etc|home|lib|lib64|opt|proc|root|sbin|srv|sys|usr|var)[^;&|]*\s-delete(?:\s|$|[;&|])/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo\s+)?find\s+\/(?:\s|bin|boot|dev|etc|home|lib|lib64|opt|proc|root|sbin|srv|sys|usr|var)[^;&|]*-exec\s+(?:\/(?:usr\/)?s?bin\/)?rm\b/.test(command),
  },
  {
    pattern: "disk wipe",
    reasonKey: "desktop.safetyReasonDiskWipe",
    test: (command: string) =>
      /(?:^|[;&|]\s*)(?:sudo\s+)?(?:wipefs|blkdiscard)\s+(?:-\S+\s+)*\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+|hd[a-z]\d*|vd[a-z]\d*|mmcblk\d+)(?:\s|$|[;&|])/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo\s+)?shred\s+(?:\S+\s+)*\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+|hd[a-z]\d*|vd[a-z]\d*|mmcblk\d+)(?:\s|$|[;&|])/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo\s+)?sgdisk\s+(?:-\S+\s+)*(?:--zap-all|-z)\b/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo\s+)?parted\s+(?:-\S+\s+)*\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+|hd[a-z]\d*|vd[a-z]\d*|mmcblk\d+)\s+.*\brm\b/.test(command),
  },
  {
    pattern: "iptables -F",
    reasonKey: "desktop.safetyReasonFirewallFlush",
    test: (command: string) => /(?:^|[;&|]\s*)(?:sudo\s+)?(?:iptables|ip6tables|nft(?:ables)?)\s+(?:-\S+\s+)*-(?:f|x|z|-flush|-delete-chain|-zero)(?:\s|$|[;&|])/.test(command),
  },
  {
    pattern: "remote pipeline",
    reasonKey: "desktop.safetyReasonRemoteShellPipe",
    test: (command: string) =>
      /\b(?:curl|wget)\s+[^|]+\|\s*\S+/.test(command) ||
      /\bbase64\s+(?:-d|--decode|-d\s+|--decode\s+)[^|]*\|\s*\S+/.test(command) ||
      /\|\s*base64\s+(?:-d|--decode)[^|]*\|\s*\S+/.test(command),
  },
  {
    pattern: "wget -O /",
    reasonKey: "desktop.safetyReasonRootDownloadOverwrite",
    test: (command: string) =>
      /(?:^|[;&|]\s*)(?:sudo\s+)?wget\s+(?:[^\s]+\s+)*(?:-o\s+|--output-document(?:=|\s+))\/(?:etc|bin|sbin|usr|boot|dev|proc|sys|var|lib|lib64|root)\b/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo\s+)?curl\s+(?:[^\s]+\s+)*(?:-o\s+|--output\s+)\/(?:etc|bin|sbin|usr|boot|dev|proc|sys|var|lib|lib64|root)\b/.test(command),
  },
  {
    pattern: "shutdown",
    reasonKey: "desktop.safetyReasonHostShutdown",
    test: (command: string) => /(?:^|[;&|]\s*)(?:sudo\s+)?(?:shutdown|halt|poweroff|reboot)(?:\s+-\S+)*(?:\s+now)?(?:\s|$|[;&|>])/.test(command),
  },
  {
    pattern: "windows destructive",
    reasonKey: "desktop.safetyReasonWindowsDestructive",
    test: (command: string) =>
      /(?:^|[;&|]\s*)del\s+(?:\/[a-z]\s+)*(?:[a-z]:\\|\\\\|%systemroot%|%windir%)/i.test(command) ||
      /(?:^|[;&|]\s*)rd\s+\/s\s+(?:\/q\s+)?(?:[a-z]:\\|\\\\)/i.test(command) ||
      /(?:^|[;&|]\s*)rmdir\s+\/s\s+(?:\/q\s+)?(?:[a-z]:\\|\\\\)/i.test(command) ||
      /(?:^|[;&|]\s*)format\s+[a-z]:(?:\s|$|[;&|])/i.test(command) ||
      /(?:^|[;&|]\s*)cipher\s+\/w:[a-z]:/i.test(command) ||
      /(?:^|[;&|]\s*)diskpart(?:\s|$|[;&|])/i.test(command),
  },
  {
    pattern: "windows admin destructive",
    reasonKey: "desktop.safetyReasonWindowsAdminDestructive",
    test: (command: string) =>
      /(?:^|[;&|]\s*)(?:[a-z0-9_.-]+\s+(?:-[a-z0-9_.-]+\s+)*)?(?:remove-item|rm|ri|del|erase|rmdir)\s+(?=[^;&|]*(?:-recurse|-r\b|\/s\b))[^;&|]*(?:[a-z]:\\(?:\s|$|[;&|])|[a-z]:\\(?:windows|program files|programdata|users|documents and settings|system volume information)\b|\\\\|%systemroot%|%windir%)/i.test(command) ||
      /(?:^|[;&|]\s*)(?:[a-z0-9_.-]+\s+(?:-[a-z0-9_.-]+\s+)*)?(?:clear-disk|format-volume|initialize-disk|remove-partition|stop-computer|restart-computer)(?:\s|$|[;&|])/i.test(command),
  },
  { pattern: "drop database", reasonKey: "desktop.safetyReasonDropDatabase", test: (command: string) => command.includes("drop database") },
  {
    pattern: "command substitution",
    reasonKey: "desktop.safetyReasonCommandSubstitution",
    test: (command: string) => /\$\([^)]*\)/.test(command) || /`[^`]+`/.test(command),
  },
] as const;

const sensitiveKeys = ["password", "passwd", "passphrase", "secret", "token", "api_key", "apikey", "private_key"];

export type DangerousCommandMatch = {
  pattern: string;
  reasonKey: TranslationKey;
};

export type TerminalCommandDecision =
  | { action: "ignore" }
  | { action: "allow"; command: string; displayCommand: string }
  | { action: "block"; command: string; displayCommand: string; match: DangerousCommandMatch };

export function interceptTerminalCommand(command: string): TerminalCommandDecision {
  const trimmed = command.trim();

  if (!trimmed) {
    return { action: "ignore" };
  }

  const displayCommand = redactLogLine(trimmed);
  const match = detectDangerousCommand(trimmed);

  if (match) {
    return { action: "block", command: trimmed, displayCommand, match };
  }

  return { action: "allow", command: trimmed, displayCommand };
}

export function detectDangerousCommand(command: string): DangerousCommandMatch | null {
  const trimmed = command.trim().replace(/\s+/g, " ").toLowerCase();
  const expanded = expandShellVariables(trimmed);
  const normalized = expanded.replace(/['"]/g, "");
  const hit = dangerousPatterns.find((entry) => entry.test(normalized));
  return hit ? { pattern: hit.pattern, reasonKey: hit.reasonKey } : null;
}

function expandShellVariables(command: string): string {
  const assignments = new Map<string, string>();
  let result = command;

  const assignmentPattern = /(?:^|[;&|]\s*)([a-z_][a-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g;
  let match: RegExpExecArray | null;

  while ((match = assignmentPattern.exec(command)) !== null) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    assignments.set(name, value);
  }

  if (assignments.size === 0) {
    return result;
  }

  for (const [name, value] of assignments) {
    const refPattern = new RegExp(`\\$\\{?${escapeRegExp(name)}\\}?`, "g");
    result = result.replace(refPattern, value);
  }

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactLogLine(line: string): string {
  const tokens = tokenizeCommandLine(line);
  const redactedTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const assignment = getAssignmentRedaction(token);

    if (assignment) {
      redactedTokens.push(assignment);
      continue;
    }

    if (isSensitiveFlag(token) && tokens[index + 1] && !looksLikeOption(tokens[index + 1])) {
      redactedTokens.push(token, "<redacted>");
      index += 1;
      continue;
    }

    redactedTokens.push(redactUrlCredentials(token));
  }

  return redactAuthHeaders(redactedTokens.join(" "));
}

/// Redacts the credential after `Bearer`/`Basic` auth schemes within an
/// `Authorization:` header (as seen in pasted curl commands), regardless of
/// surrounding quotes. Scoped to the header to avoid matching the plain words.
function redactAuthHeaders(line: string): string {
  return line.replace(
    /(authorization\s*:\s*["']?\s*(?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]+/gi,
    "$1<redacted>",
  );
}

/// Redacts the password in a `scheme://user:password@host` connection string,
/// keeping the rest of the URL intact for diagnostics.
function redactUrlCredentials(token: string): string {
  return token.replace(
    /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:)[^\s:@/]+(@)/gi,
    "$1<redacted>$2",
  );
}

function tokenizeCommandLine(line: string): string[] {
  const matches = line.match(/(?:[^\s"'=]+=(?:"[^"]*"|'[^']*'|[^\s]+))|(?:"[^"]*"|'[^']*'|[^\s]+)/g);
  return matches ?? [];
}

function getAssignmentRedaction(token: string): string | null {
  const separatorIndex = token.indexOf("=");

  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }

  const key = token.slice(0, separatorIndex);

  if (!isSensitiveKey(key)) {
    return null;
  }

  return `${key}=<redacted>`;
}

function isSensitiveFlag(token: string): boolean {
  return token.startsWith("--") && isSensitiveKey(token.slice(2));
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = normalizeKey(key);
  return sensitiveKeys.some((sensitive) => normalizedKey.includes(normalizeKey(sensitive)));
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/^-+/, "").replace(/[^a-z0-9]/g, "");
}

function looksLikeOption(token: string): boolean {
  return /^-{1,2}[a-z0-9][\w-]*/i.test(token);
}
