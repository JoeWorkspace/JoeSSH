import { memo } from "react";
import { Boxes, ClipboardCheck, Folder, Plus, Settings, Trash2, X } from "lucide-react";
import { Badge, Button, IconButton } from "@atlasterm/ui";
import type { Translator } from "@atlasterm/i18n";
import { useFocusTrap } from "./useFocusTrap";
import { desktopGroupLabel } from "./desktopGroups";

type GroupManagerModalProps = {
  allGroupNames: readonly string[];
  connectionCounts: Record<string, number>;
  customGroups: readonly string[];
  editingGroup: string | null;
  editingGroupName: string;
  isGroupValid: (name: string) => boolean;
  newGroupName: string;
  onClose: () => void;
  onCreateGroup: (name: string) => void;
  onDeleteGroup: (name: string) => void;
  onRenameGroup: (oldName: string, newName: string) => void;
  onSetEditingGroup: (group: string | null, name?: string) => void;
  onSetEditingGroupName: (name: string) => void;
  onSetNewGroupName: (name: string) => void;
  onStartEditGroup: (group: string, name: string) => void;
  t: Translator;
};

export const GroupManagerModal = memo(function GroupManagerModal({
  allGroupNames,
  connectionCounts,
  customGroups,
  editingGroup,
  editingGroupName,
  isGroupValid,
  newGroupName,
  onClose,
  onCreateGroup,
  onDeleteGroup,
  onRenameGroup,
  onSetEditingGroup,
  onSetEditingGroupName,
  onSetNewGroupName,
  onStartEditGroup,
  t,
}: GroupManagerModalProps) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("desktop.manageGroups")} onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="modal group-manager" ref={focusTrapRef} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2><Boxes size={18} aria-hidden="true" /> {t("desktop.manageGroups")}</h2>
          <IconButton label={t("desktop.close")} onClick={onClose}><X size={16} /></IconButton>
        </header>
        <div className="group-manager-body">
          <div className="group-manager-create">
            <input
              type="text"
              placeholder={t("desktop.newGroupName")}
              aria-label={t("desktop.newGroupName")}
              value={newGroupName}
              onChange={(e) => onSetNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newGroupName.trim() && isGroupValid(newGroupName)) {
                  onCreateGroup(newGroupName.trim());
                }
              }}
              className="group-manager-input"
              maxLength={32}
            />
            <Button size="sm" onClick={() => {
              if (newGroupName.trim() && isGroupValid(newGroupName)) {
                onCreateGroup(newGroupName.trim());
              }
            }}>
              <Plus size={14} aria-hidden="true" /> {t("desktop.createGroup")}
            </Button>
          </div>
          <ul className="group-manager-list">
            {allGroupNames.map((groupName) => {
              const isCustom = customGroups.includes(groupName);
              const connCount = connectionCounts[groupName] ?? 0;
              return (
                <li className="group-manager-item" key={groupName}>
                  {editingGroup === groupName ? (
                    <div className="group-manager-edit">
                      <input
                        type="text"
                        value={editingGroupName}
                        aria-label={t("desktop.renameGroup")}
                        onChange={(e) => onSetEditingGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editingGroupName.trim() && editingGroupName.trim() !== groupName && isGroupValid(editingGroupName)) {
                            onRenameGroup(groupName, editingGroupName.trim());
                          }
                          if (e.key === "Escape") onSetEditingGroup(null);
                        }}
                        className="group-manager-input"
                        autoFocus
                        maxLength={32}
                      />
                      <button className="icon-btn" type="button" aria-label={t("desktop.confirmRename")} onClick={() => {
                        if (editingGroupName.trim() && editingGroupName.trim() !== groupName && isGroupValid(editingGroupName)) {
                          onRenameGroup(groupName, editingGroupName.trim());
                        }
                        onSetEditingGroup(null);
                      }}><ClipboardCheck size={14} aria-hidden="true" /></button>
                      <button className="icon-btn" type="button" aria-label={t("desktop.cancelRename")} onClick={() => onSetEditingGroup(null)}><X size={14} aria-hidden="true" /></button>
                    </div>
                  ) : (
                    <>
                      <Folder size={14} aria-hidden="true" />
                      <span className="group-manager-name">{desktopGroupLabel(groupName, t)}</span>
                      <Badge tone="neutral">{connCount}</Badge>
                      {isCustom ? (
                        <div className="group-manager-actions">
                          <button className="icon-btn" type="button" aria-label={t("desktop.renameGroup")} onClick={() => onStartEditGroup(groupName, groupName)}>
                            <Settings size={13} aria-hidden="true" />
                          </button>
                          <button className="icon-btn icon-btn--danger" type="button" aria-label={t("desktop.deleteGroup")} onClick={() => onDeleteGroup(groupName)}>
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <small className="group-manager-builtin">{t("desktop.groupBuiltin")}</small>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
});
