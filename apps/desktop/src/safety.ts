import type { TranslationKey } from "@atlasterm/i18n";

// Shell variable expansion can turn an apparently harmless token sequence
// into a different command (for example, `rm -rf${IFS}/`). Keep this pattern
// deliberately small: command substitution is handled separately below.
const shellVariablePattern = /\$(?:\{?[a-z_][a-z0-9_]*\}?)/i;

const dangerousPatterns = [
  {
    pattern: "rm -rf /",
    reasonKey: "desktop.safetyReasonRmRoot",
    test: (command: string) =>
      /(?:^|[;&|]\s*)(?:sudo(?:\s+-\S+)*\s+)?(?:\/(?:usr\/)?s?bin\/)?rm\s+(?:(?:-(?=[a-z-]*r)(?=[a-z-]*f)[a-z-]*)|(?:(?:-[a-z]+\s+|--recursive\s+|--force\s+|--no-preserve-root\s+)*(?:--recursive|--force)(?:\s+(?:-[a-z]+|--recursive|--force|--no-preserve-root))*))(?:\s+--no-preserve-root)?\s+\/(?:\s|$|[;&|])/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo(?:\s+-\S+)*\s+)?(?:\/(?:usr\/)?s?bin\/)?rm\s+(?:(?:-(?=[a-z-]*r)(?=[a-z-]*f)[a-z-]*)|(?:(?:-[a-z]+\s+|--recursive\s+|--force\s+|--no-preserve-root\s+)*(?:--recursive|--force)(?:\s+(?:-[a-z]+|--recursive|--force|--no-preserve-root))*))\s+\/\*(?:\s|$|[;&|])/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo(?:\s+-\S+)*\s+)?(?:\/(?:usr\/)?s?bin\/)?rm\s+-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*\s+\/(?:\s|$|[;&|])/.test(command) ||
      /(?:^|[;&|]\s*)(?:sudo(?:\s+-\S+)*\s+)?(?:\/(?:usr\/)?s?bin\/)?rm\s+-[a-z]*f[a-z]*\s+-[a-z]*r[a-z]*\s+\/(?:\s|$|[;&|])/.test(command) ||
      matchesRmRootVariant(command),
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
    pattern: "curl|sh",
    reasonKey: "desktop.safetyReasonRemoteShellPipe",
    test: (command: string) =>
      /\bcurl\s+[^|]+\|\s*(?:sudo\s+)?(?:ba|z|k|d)?sh\b/.test(command) ||
      /\bwget\s+[^|]+\|\s*(?:sudo\s+)?(?:ba|z|k|d)?sh\b/.test(command) ||
      /\bbase64\s+(?:-d|--decode|-d\s+|--decode\s+)[^|]*\|\s*(?:sudo\s+)?(?:ba|z|k|d)?sh\b/.test(command) ||
      /\|\s*base64\s+(?:-d|--decode)[^|]*\|\s*(?:sudo\s+)?(?:ba|z|k|d)?sh\b/.test(command),
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
    pattern: "powershell destructive",
    reasonKey: "desktop.safetyReasonPowershellDestructive",
    test: (command: string) =>
      /(?:^|[;&|]\s*)(?:(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+(?:[^\s;&|]+\s+){0,8})?(?:remove-item|rm|ri|del|erase|rmdir)\s+(?=[^;&|]*(?:-recurse|-r\b|\/s\b))[^;&|]*(?:[a-z]:\\(?:\s|$|[;&|])|[a-z]:\\(?:windows|program files|programdata|users|documents and settings|system volume information)\b|\\\\|%systemroot%|%windir%)/i.test(command) ||
      /(?:^|[;&|]\s*)(?:(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+(?:[^\s;&|]+\s+){0,8})?(?:clear-disk|format-volume|initialize-disk|remove-partition|stop-computer|restart-computer)(?:\s|$|[;&|])/i.test(command),
  },
  { pattern: "drop database", reasonKey: "desktop.safetyReasonDropDatabase", test: (command: string) => command.includes("drop database") },
  {
    pattern: "command substitution",
    reasonKey: "desktop.safetyReasonCommandSubstitution",
    test: (command: string) => /\$\([^)]*\)/.test(command) || /`[^`]+`/.test(command),
  },
  {
    pattern: "shell variable expansion",
    reasonKey: "desktop.safetyReasonCommandSubstitution",
    test: (command: string) => shellVariablePattern.test(command),
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
  const expanded = expandShellVariables(trimmed)
    // `${IFS}` expands to shell whitespace; normalize it before matching so
    // it cannot hide destructive command arguments.
    .replace(/\$\{ifs\}|\$ifs/gi, " ")
    .replace(/\s+/g, " ");
  const normalized = expanded.replace(/['"]/g, "");
  const hit = dangerousPatterns.find((entry) => entry.test(normalized));
  return hit ? { pattern: hit.pattern, reasonKey: hit.reasonKey } : null;
}

function matchesRmRootVariant(command: string): boolean {
  const tokens = command.split(/\s+/).filter(Boolean);

  for (const [index, token] of tokens.entries()) {
    const executable = token.split("/").pop();
    if (executable !== "rm") continue;

    let recursive = false;
    let force = false;
    let optionsDone = false;
    for (const argument of tokens.slice(index + 1)) {
      if (!optionsDone && argument === "--") {
        optionsDone = true;
        continue;
      }
      if (!optionsDone && argument.startsWith("--")) {
        if (argument === "--recursive") recursive = true;
        if (argument === "--force") force = true;
        continue;
      }
      if (!optionsDone && argument.startsWith("-") && argument.length > 1) {
        for (const flag of argument.slice(1)) {
          if (flag === "r") recursive = true;
          if (flag === "f") force = true;
        }
        continue;
      }

      optionsDone = true;
      const target = argument.replace(/[;&|>]+$/g, "");
      const canonicalTarget = target.replace(/\/+$/g, "") || "/";
      if (
        recursive &&
        force &&
        (canonicalTarget === "/" ||
          canonicalTarget === "/." ||
          canonicalTarget === "/.." ||
          canonicalTarget.startsWith("/*") ||
          canonicalTarget.startsWith("//"))
      ) {
        return true;
      }
    }
  }

  return false;
}

export type SnippetCommandValidation =
  | { valid: true }
  | { valid: false; reason: "sensitive" | "separator" | "empty" };

/** V1 runbooks are one redacted, single shell command and never carry secrets. */
export function validateSnippetCommand(command: string): SnippetCommandValidation {
  const trimmed = command.trim();
  if (!trimmed) return { valid: false, reason: "empty" };

  if (
    /(?:^|\s)(?:--?(?:password|passwd|passphrase|secret|token|api[-_]?key|private[-_]?key)(?:=|\s+))/i.test(
      trimmed,
    ) ||
    /(?:^|\s)(?:password|passwd|passphrase|secret|token|api[-_]?key|private[-_]?key)\s*=/i.test(
      trimmed,
    ) ||
    /(?:authorization\s*:\s*(?:bearer|basic)\s+|:\/\/[^\s:@/]+:[^\s:@/]+@)/i.test(
      trimmed,
    ) ||
    hasSensitiveCredentialOption(trimmed)
  ) {
    return { valid: false, reason: "sensitive" };
  }

  if (
    /[;&|`\n\r]/.test(trimmed) ||
    /\$\([^)]*\)/.test(trimmed) ||
    shellVariablePattern.test(trimmed) ||
    /(?:^|\s)(?:sudo|su|doas)(?:\s|$)/i.test(trimmed) ||
    /(?:^|\s)(?:bash|sh|zsh|fish|pwsh|powershell)(?:\.exe)?(?:\s|$)/i.test(
      trimmed,
    )
  ) {
    return { valid: false, reason: "separator" };
  }

  return { valid: true };
}

function expandShellVariables(command: string): string {
  const assignments = new Map<string, string>();
  // IFS is commonly used to hide argument separators from text-based checks.
  // Expand the two forms that matter for command-token inspection before the
  // normal assignment expansion below.
  let result = command.replace(/\$\{IFS\}|\$IFS/g, " ");

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
    const credentialOption = getCredentialOption(token, tokens, index);
    if (credentialOption) {
      if (credentialOption.kind === "attached") {
        redactedTokens.push(credentialOption.redacted);
        continue;
      }

      redactedTokens.push(token);
      const nextToken = tokens[index + 1];
      if (
        nextToken &&
        (credentialOption.consumeOptionLike || !looksLikeOption(normalizeToken(nextToken)))
      ) {
        const isCurlUser =
          (normalizeToken(token) === "-u" || normalizeToken(token).toLowerCase() === "--user") &&
          !/[:@]/.test(normalizeToken(nextToken));
        redactedTokens.push(isCurlUser ? nextToken : "<redacted>");
        index += 1;
      }
      continue;
    }

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

type CredentialOption =
  | { kind: "next"; consumeOptionLike?: boolean }
  | { kind: "attached"; redacted: string };

function hasSensitiveCredentialOption(command: string): boolean {
  const tokens = tokenizeCommandLine(command);

  for (let index = 0; index < tokens.length; index += 1) {
    if (getCredentialOption(tokens[index], tokens, index)) return true;
  }

  return false;
}

function getCredentialOption(
  token: string,
  tokens: string[],
  index: number,
): CredentialOption | null {
  const normalized = normalizeToken(token);
  const lower = normalized.toLowerCase();
  if (!normalized) return null;

  if (lower === "--password") return { kind: "next", consumeOptionLike: true };
  if (lower.startsWith("--password=")) {
    const separatorIndex = normalized.indexOf("=");
    return {
      kind: "attached",
      redacted: `${normalized.slice(0, separatorIndex)}=<redacted>`,
    };
  }

  if (hasCommandBefore(tokens, index, ["sshpass"])) {
    if (normalized === "-p") return { kind: "next", consumeOptionLike: true };
    if (normalized.startsWith("-p") && normalized.length > 2) {
      return { kind: "attached", redacted: "-p<redacted>" };
    }
  }

  if (
    hasCommandBefore(tokens, index, ["mysql", "mariadb"]) &&
    normalized === "-p"
  ) {
    return { kind: "next" };
  }
  if (
    hasCommandBefore(tokens, index, ["mysql", "mariadb"]) &&
    normalized.startsWith("-p") &&
    normalized.length > 2
  ) {
    return { kind: "attached", redacted: "-p<redacted>" };
  }

  if (hasCommandBefore(tokens, index, ["curl", "wget"])) {
    if (normalized === "-u" || lower === "--user") {
      return { kind: "next", consumeOptionLike: true };
    }
    if (lower.startsWith("--user=")) {
      const separatorIndex = normalized.indexOf("=");
      return {
        kind: "attached",
        redacted: `${normalized.slice(0, separatorIndex)}=<redacted>`,
      };
    }
    if (normalized.startsWith("-u") && normalized.length > 2) {
      return { kind: "attached", redacted: "-u<redacted>" };
    }
  }

  return null;
}

function normalizeToken(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === "'" || first === '"') && last === first) {
      return token.slice(1, -1);
    }
  }
  return token;
}

function hasCommandBefore(tokens: string[], index: number, names: readonly string[]): boolean {
  return tokens.slice(0, index).some((token) => {
    const normalized = normalizeToken(token);
    if (!normalized || normalized.includes("=") || looksLikeOption(normalized)) return false;
    const commandName = normalized.split("/").pop()?.toLowerCase();
    return commandName !== undefined && names.includes(commandName);
  });
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
