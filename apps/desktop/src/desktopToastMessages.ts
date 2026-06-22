import type { Translator } from "@atlasterm/i18n";

export function connectionSwitchedToast(t: Translator, name: string): string {
  return t("desktop.connectionSwitched", { name });
}

export function connectionMovedToast(t: Translator, connection: string, group: string): string {
  return t("desktop.connectionMoved", { connection, group });
}

export function connectionsImportedToast(t: Translator, count: number): string {
  return t("desktop.connectionsImported", { count });
}

export function connectionConnectToast(t: Translator, name: string): string {
  return t("desktop.connectionConnectToast", { name });
}

export function connectionCreatedToast(t: Translator, name: string): string {
  return t("desktop.connectionCreated", { name });
}

export function connectionTestResultToast(t: Translator, result: string): string {
  return t("desktop.connectionTestResult", { result });
}

export function builtinConnectionEditUnavailableToast(t: Translator): string {
  return t("desktop.builtinConnectionEditUnavailable");
}

export function builtinConnectionDeleteUnavailableToast(t: Translator): string {
  return t("desktop.builtinConnectionDeleteUnavailable");
}

export function duplicateConnectionName(t: Translator, name: string, copyNumber = 1): string {
  return copyNumber <= 1
    ? t("desktop.connectionCopyName", { name })
    : t("desktop.connectionCopyNameNumbered", { name, number: copyNumber });
}

export function connectionDuplicatedToast(t: Translator, name: string): string {
  return t("desktop.connectionDuplicated", { name });
}

export function connectionDeletedToast(t: Translator, name: string): string {
  return t("desktop.connectionDeleted", { name });
}

export function connectionEditedToast(t: Translator, name: string): string {
  return t("desktop.connectionEdited", { name });
}

export function groupCreatedToast(t: Translator, name: string): string {
  return t("desktop.groupCreatedToast", { name });
}

export function groupDeletedToast(t: Translator, name: string): string {
  return t("desktop.groupDeletedToast", { name });
}

export function groupRenamedToast(t: Translator, name: string): string {
  return t("desktop.groupRenamedToast", { name });
}

export function sftpUploadCompleteToast(t: Translator, name: string): string {
  return t("desktop.sftpUploadComplete", { name });
}

export function sshCommandCopiedToast(t: Translator, name: string): string {
  return t("desktop.sshCommandCopied", { name });
}

export function sshCommandCopyFailedToast(t: Translator): string {
  return t("desktop.sshCommandCopyFailed");
}
