import { memo, useState, type FormEvent } from "react";
import { Plug, X } from "lucide-react";
import { Button, IconButton } from "@atlasterm/ui";
import type { Translator } from "@atlasterm/i18n";
import { InlineAlert } from "./InlineAlert";
import { useFocusTrap } from "./useFocusTrap";
import { useConnectForm, validateConnectForm, type ConnectFormFields, type ConnectSubmitInput } from "./useConnectForm";

type HostKeyProbeResult = {
  status: "unknown" | "match" | "changed";
  presented_fingerprint: string;
  stored_fingerprint: string | null;
};

type PendingHostKeyConfirmation = {
  host: string;
  port: number;
  fingerprint: string;
};

type ConnectModalProps = {
  defaultHost?: string;
  defaultPort?: number;
  defaultUsername?: string;
  onClose: () => void;
  onConnect: (input: ConnectSubmitInput) => Promise<string>;
  onHostKeyProbe?: (host: string, port: number) => Promise<HostKeyProbeResult>;
  onConnected: (sessionId: string) => void;
  t: Translator;
};

export const ConnectModal = memo(function ConnectModal({
  defaultHost,
  defaultPort,
  defaultUsername,
  onClose,
  onConnect,
  onHostKeyProbe,
  onConnected,
  t,
}: ConnectModalProps) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true);
  const { fields, status, isValid, setField, submit } = useConnectForm(onConnect, {
    host: defaultHost ?? "",
    port: defaultPort ? String(defaultPort) : "22",
    username: defaultUsername ?? "",
  });
  const [pendingHostKey, setPendingHostKey] = useState<PendingHostKeyConfirmation | null>(null);
  const [hostKeyError, setHostKeyError] = useState<string | null>(null);
  const [probingHostKey, setProbingHostKey] = useState(false);
  const connecting = status.phase === "connecting" || probingHostKey;

  function updateField<K extends keyof ConnectFormFields>(key: K, value: ConnectFormFields[K]) {
    setPendingHostKey(null);
    setHostKeyError(null);
    setField(key, value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateConnectForm(fields);
    if (!validation.ok) {
      await submit();
      return;
    }

    const input = validation.value;
    const confirmedFingerprint =
      pendingHostKey?.host === input.host && pendingHostKey.port === input.port
        ? pendingHostKey.fingerprint
        : undefined;

    if (onHostKeyProbe && !input.pinnedFingerprint && !confirmedFingerprint) {
      setHostKeyError(null);
      setProbingHostKey(true);
      try {
        const probe = await onHostKeyProbe(input.host, input.port);
        if (probe.status === "changed") {
          setHostKeyError(t("desktop.hostKeyChangedDetail", {
            host: input.host,
            port: input.port,
            stored: probe.stored_fingerprint ?? "none",
            presented: probe.presented_fingerprint,
          }));
          setPendingHostKey(null);
          return;
        }
        if (probe.status === "unknown") {
          setPendingHostKey({ host: input.host, port: input.port, fingerprint: probe.presented_fingerprint });
          return;
        }
      } catch (error) {
        setHostKeyError(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        setProbingHostKey(false);
      }
    }

    const sessionId = await submit(
      confirmedFingerprint ? { ...input, pinnedFingerprint: confirmedFingerprint } : input,
    );
    if (sessionId) {
      onConnected(sessionId);
      onClose();
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("desktop.connectTitle")}
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="modal connect-modal" ref={focusTrapRef} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2><Plug size={18} aria-hidden="true" /> {t("desktop.connectTitle")}</h2>
          <IconButton label={t("desktop.close")} onClick={onClose}><X size={16} /></IconButton>
        </header>
        <form className="connect-form" onSubmit={handleSubmit}>
          <label className="connect-field connect-field--host">
            <span>{t("desktop.host")}</span>
            <input type="text" value={fields.host} autoFocus
              onChange={(e) => updateField("host", e.target.value)} />
          </label>
          <label className="connect-field connect-field--port">
            <span>{t("desktop.port")}</span>
            <input type="number" min={1} max={65535} value={fields.port}
              onChange={(e) => updateField("port", e.target.value)} />
          </label>
          <label className="connect-field">
            <span>{t("desktop.user")}</span>
            <input type="text" value={fields.username}
              onChange={(e) => updateField("username", e.target.value)} />
          </label>
          <label className="connect-field">
            <span>{t("desktop.authMethod")}</span>
            <select value={fields.authKind} onChange={(e) => updateField("authKind", e.target.value as typeof fields.authKind)}>
              <option value="password">{t("desktop.authPassword")}</option>
              <option value="private_key">{t("desktop.authPrivateKey")}</option>
            </select>
          </label>
          {fields.authKind === "password" ? (
            <label className="connect-field">
              <span>{t("desktop.authPassword")}</span>
              <input type="password" value={fields.password}
                onChange={(e) => updateField("password", e.target.value)} />
            </label>
          ) : (
            <>
              <label className="connect-field">
                  <span>{t("desktop.authPrivateKey")}</span>
                  <textarea rows={4} value={fields.pem}
                    onChange={(e) => updateField("pem", e.target.value)} />
              </label>
              <label className="connect-field">
                  <span>{t("desktop.passphrase")}</span>
                  <input type="password" value={fields.passphrase}
                    onChange={(e) => updateField("passphrase", e.target.value)} />
              </label>
            </>
          )}
          <label className="connect-field">
            <span>{t("desktop.pinnedFingerprint")}</span>
            <input type="text" value={fields.pinnedFingerprint}
              onChange={(e) => updateField("pinnedFingerprint", e.target.value)} />
          </label>
          {pendingHostKey ? (
            <section className="host-key-confirmation" role="status" aria-live="polite">
              <strong>{t("desktop.hostKeyConfirmTitle")}</strong>
              <small>{pendingHostKey.host}:{pendingHostKey.port}</small>
              <small>{t("desktop.hostKeyConfirmDetail")}</small>
              <small>{t("desktop.hostKeyPresentedFingerprint")}</small>
              <code>{pendingHostKey.fingerprint}</code>
            </section>
          ) : null}
          {hostKeyError ? (
            <InlineAlert className="connect-error" title={t("desktop.hostKeyVerificationFailed")} detail={hostKeyError} />
          ) : null}
          {status.phase === "error" ? (
            <InlineAlert className="connect-error" title={t("desktop.connectFailed")} detail={status.message} />
          ) : null}
          <div className="connect-actions">
            <Button type="submit" disabled={!isValid || connecting}>
              {connecting ? t("desktop.connecting") : pendingHostKey ? t("desktop.trustHostKeyAndConnect") : t("desktop.connectAction")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
});
