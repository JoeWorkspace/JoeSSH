import { useCallback, useMemo, useState } from "react";

export type ConnectAuthKind = "password" | "private_key";

export type ConnectFormFields = {
  host: string;
  port: string;
  username: string;
  authKind: ConnectAuthKind;
  password: string;
  pem: string;
  passphrase: string;
  pinnedFingerprint: string;
};

export type ConnectStatus =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "error"; message: string }
  | { phase: "connected"; sessionId: string };

export type ConnectSubmitInput = {
  host: string;
  port: number;
  username: string;
  auth:
    | { kind: "password"; password: string }
    | { kind: "private_key"; pem: string; passphrase?: string };
  pinnedFingerprint?: string;
};

const DEFAULT_FIELDS: ConnectFormFields = {
  host: "",
  port: "22",
  username: "",
  authKind: "password",
  password: "",
  pem: "",
  passphrase: "",
  pinnedFingerprint: "",
};

type ConnectInitialFields = Partial<ConnectFormFields>;

function createInitialFields(initialFields: ConnectInitialFields = {}): ConnectFormFields {
  return {
    ...DEFAULT_FIELDS,
    ...initialFields,
  };
}

/// Parse/validate the form into a submit payload, or return why it is invalid.
export function validateConnectForm(
  fields: ConnectFormFields,
): { ok: true; value: ConnectSubmitInput } | { ok: false; reason: string } {
  const host = fields.host.trim();
  if (!host) return { ok: false, reason: "host" };

  const port = Number(fields.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: "port" };
  }

  const username = fields.username.trim();
  if (!username) return { ok: false, reason: "username" };

  let auth: ConnectSubmitInput["auth"];
  if (fields.authKind === "password") {
    if (!fields.password) return { ok: false, reason: "password" };
    auth = { kind: "password", password: fields.password };
  } else {
    if (!fields.pem.trim()) return { ok: false, reason: "pem" };
    auth = {
      kind: "private_key",
      pem: fields.pem,
      passphrase: fields.passphrase ? fields.passphrase : undefined,
    };
  }

  const pinned = fields.pinnedFingerprint.trim();
  return {
    ok: true,
    value: { host, port, username, auth, pinnedFingerprint: pinned || undefined },
  };
}

/// State machine for the connect form: field edits, validation, and the
/// connect lifecycle. `connect` is injected so the hook stays IPC-free/testable.
export function useConnectForm(
  connect: (input: ConnectSubmitInput) => Promise<string>,
  initialFields?: ConnectInitialFields,
) {
  const [initialSnapshot] = useState(() => createInitialFields(initialFields));
  const [fields, setFields] = useState<ConnectFormFields>(initialSnapshot);
  const [status, setStatus] = useState<ConnectStatus>({ phase: "idle" });

  const validation = useMemo(() => validateConnectForm(fields), [fields]);
  const isValid = validation.ok;

  const setField = useCallback(<K extends keyof ConnectFormFields>(key: K, value: ConnectFormFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setStatus((prev) => (prev.phase === "error" ? { phase: "idle" } : prev));
  }, []);

  const reset = useCallback(() => {
    setFields(initialSnapshot);
    setStatus({ phase: "idle" });
  }, [initialSnapshot]);

  const submit = useCallback(async (overrideInput?: ConnectSubmitInput): Promise<string | undefined> => {
    const nextValidation = overrideInput ? { ok: true as const, value: overrideInput } : validation;
    if (!nextValidation.ok) {
      setStatus({ phase: "error", message: nextValidation.reason });
      return undefined;
    }
    setStatus({ phase: "connecting" });
    try {
      const sessionId = await connect(nextValidation.value);
      setStatus({ phase: "connected", sessionId });
      return sessionId;
    } catch (error) {
      setStatus({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  }, [connect, validation]);

  return { fields, status, isValid, setField, reset, submit };
}
