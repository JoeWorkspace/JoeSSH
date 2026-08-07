import { memo, useState, type FormEvent } from "react";
import { Braces, Plus, Save, X } from "lucide-react";
import { Button, IconButton } from "@atlasterm/ui";
import type { Translator } from "@atlasterm/i18n";
import { InlineAlert } from "./InlineAlert";
import { useFocusTrap } from "./useFocusTrap";
import {
  MAX_SNIPPET_COMMAND_LENGTH,
  MAX_SNIPPET_NAME_LENGTH,
  normalizePersistedCommandSnippet,
  type CommandSnippetSaveResult,
  type CommandSnippetDraft,
  type PersistedCommandSnippet,
} from "./persistence";

type CommandSnippetModalProps = {
  edit?: PersistedCommandSnippet;
  onClose: () => void;
  onSave: (snippet: CommandSnippetDraft) => CommandSnippetSaveResult;
  t: Translator;
};

export const CommandSnippetModal = memo(function CommandSnippetModal({
  edit,
  onClose,
  onSave,
  t,
}: CommandSnippetModalProps) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true);
  const [name, setName] = useState(edit?.name ?? "");
  const [command, setCommand] = useState(edit?.command ?? "");
  const [saveError, setSaveError] = useState<Exclude<
    CommandSnippetSaveResult,
    "saved"
  > | null>(null);

  const trimmedName = name.trim();
  const trimmedCommand = command.trim();
  const canSave = trimmedName.length > 0 && trimmedCommand.length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !canSave ||
      !normalizePersistedCommandSnippet({
        id: edit?.id,
        name: trimmedName,
        command: trimmedCommand,
      })
    ) {
      setSaveError("validation");
      return;
    }

    const result = onSave({
      id: edit?.id,
      name: trimmedName,
      command: trimmedCommand,
    });
    if (result === "saved") {
      onClose();
      return;
    }
    setSaveError(result);
  }

  const title = edit ? t("desktop.snippetEdit") : t("desktop.snippetAdd");

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="modal command-snippet-modal"
        ref={focusTrapRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2>
            <Braces size={18} aria-hidden="true" /> {title}
          </h2>
          <IconButton label={t("desktop.close")} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <form className="connect-form" onSubmit={handleSubmit}>
          <label className="connect-field">
            <span id="snippet-name-label">{t("desktop.snippetName")}</span>
            <input
              aria-labelledby="snippet-name-label"
              type="text"
              data-autofocus
              value={name}
              maxLength={MAX_SNIPPET_NAME_LENGTH}
              onChange={(event) => {
                setName(event.target.value);
                setSaveError(null);
              }}
            />
          </label>
          <label className="connect-field">
            <span id="snippet-command-label">{t("desktop.snippetCommand")}</span>
            <textarea
              aria-labelledby="snippet-command-label"
              value={command}
              maxLength={MAX_SNIPPET_COMMAND_LENGTH}
              rows={5}
              spellCheck={false}
              onChange={(event) => {
                setCommand(event.target.value);
                setSaveError(null);
              }}
            />
          </label>
          {saveError ? (
            <InlineAlert
              className="connect-error"
              title={
                saveError === "duplicate"
                  ? t("desktop.snippetNameTaken")
                  : saveError === "limit"
                    ? t("desktop.snippetLimit")
                    : saveError === "storage"
                      ? t("desktop.snippetStorageFailed")
                    : t("desktop.snippetValidation")
              }
            />
          ) : null}
          <div className="connect-actions">
            <Button type="submit" disabled={!canSave}>
              {edit ? (
                <Save size={14} aria-hidden="true" />
              ) : (
                <Plus size={14} aria-hidden="true" />
              )}
              {t("desktop.snippetSave")}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("desktop.snippetCancel")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
});
