import { memo, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button, IconButton } from "@atlasterm/ui";
import type { Translator } from "@atlasterm/i18n";
import { InlineAlert } from "./InlineAlert";
import { useFocusTrap } from "./useFocusTrap";
import type { PersistedConnection } from "./persistence";

type NewConnectionModalProps = {
  defaultGroup: string;
  isNameAvailable: (name: string) => boolean;
  onClose: () => void;
  onCreate: (connection: PersistedConnection) => boolean;
  edit?: PersistedConnection;
  t: Translator;
};

export const NewConnectionModal = memo(function NewConnectionModal({
  defaultGroup,
  isNameAvailable,
  onClose,
  onCreate,
  edit,
  t,
}: NewConnectionModalProps) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true);
  const [name, setName] = useState(edit?.name ?? "");
  const [host, setHost] = useState(edit?.host ?? "");
  const [group, setGroup] = useState(edit?.group ?? defaultGroup);
  const [tags, setTags] = useState((edit?.tags ?? []).join(", "));

  const trimmedName = name.trim();
  // In edit mode the name is fixed (it is the identity key), so the
  // availability check only applies when creating.
  const nameAvailable = edit ? true : trimmedName.length > 0 && isNameAvailable(trimmedName);
  const canCreate = nameAvailable && trimmedName.length > 0 && host.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) return;
    const created = onCreate({
      name: trimmedName,
      host: host.trim(),
      group: group.trim() || defaultGroup,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    });
    if (created) onClose();
  }

  const title = edit ? t("desktop.contextEdit") : t("desktop.newConnection");

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="modal connect-modal" ref={focusTrapRef} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2><Plus size={18} aria-hidden="true" /> {title}</h2>
          <IconButton label={t("desktop.close")} onClick={onClose}><X size={16} /></IconButton>
        </header>
        <form className="connect-form" onSubmit={handleSubmit}>
          <label className="connect-field">
            <span>{t("desktop.connectionName")}</span>
            <input type="text" value={name} autoFocus disabled={edit !== undefined} onChange={(e) => setName(e.target.value)} />
          </label>
          {trimmedName.length > 0 && !nameAvailable ? (
            <InlineAlert className="connect-error" title={t("desktop.nameTaken")} />
          ) : null}
          <label className="connect-field">
            <span>{t("desktop.host")}</span>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} />
          </label>
          <label className="connect-field">
            <span>{t("desktop.group")}</span>
            <input type="text" value={group} onChange={(e) => setGroup(e.target.value)} />
          </label>
          <label className="connect-field">
            <span>{t("desktop.tagsCommaHint")}</span>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <div className="connect-actions">
            <Button type="submit" disabled={!canCreate}>{t("desktop.createConnection")}</Button>
          </div>
        </form>
      </div>
    </div>
  );
});
