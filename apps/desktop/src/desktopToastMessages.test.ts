import { describe, expect, it } from "vitest";
import type { TranslationKey, Translator } from "@atlasterm/i18n";
import {
  builtinConnectionDeleteUnavailableToast,
  builtinConnectionEditUnavailableToast,
  connectionConnectToast,
  connectionCreatedToast,
  connectionDeletedToast,
  connectionDuplicatedToast,
  connectionEditedToast,
  connectionMovedToast,
  connectionSwitchedToast,
  connectionTestResultToast,
  connectionsImportFailedToast,
  connectionsImportedToast,
  duplicateConnectionName,
  groupCreatedToast,
  groupDeletedToast,
  groupRenamedToast,
  sftpUploadCompleteToast,
  sshCommandCopiedToast,
  sshCommandCopyFailedToast,
} from "./desktopToastMessages";

const calls: Array<{ key: TranslationKey; values?: Record<string, string | number> }> = [];
const t: Translator = (key, values) => {
  calls.push({ key, values });
  return values ? `${key}:${JSON.stringify(values)}` : key;
};

describe("desktop toast messages", () => {
  it("formats connection and SFTP toast copy through the translator", () => {
    calls.length = 0;
    expect(connectionSwitchedToast(t, "prod-edge-01")).toBe('desktop.connectionSwitched:{"name":"prod-edge-01"}');
    expect(connectionMovedToast(t, "prod-edge-01", "Staging")).toBe('desktop.connectionMoved:{"connection":"prod-edge-01","group":"Staging"}');
    expect(connectionsImportedToast(t, 3)).toBe('desktop.connectionsImported:{"count":3}');
    expect(connectionsImportFailedToast(t)).toBe("desktop.connectionsImportFailed");
    expect(connectionConnectToast(t, "prod-edge-01")).toBe('desktop.connectionConnectToast:{"name":"prod-edge-01"}');
    expect(connectionCreatedToast(t, "jumpbox")).toBe('desktop.connectionCreated:{"name":"jumpbox"}');
    expect(connectionTestResultToast(t, "28 ms")).toBe('desktop.connectionTestResult:{"result":"28 ms"}');
    expect(sftpUploadCompleteToast(t, "audit.log")).toBe('desktop.sftpUploadComplete:{"name":"audit.log"}');
    expect(calls.map((call) => call.key)).toEqual([
      "desktop.connectionSwitched",
      "desktop.connectionMoved",
      "desktop.connectionsImported",
      "desktop.connectionsImportFailed",
      "desktop.connectionConnectToast",
      "desktop.connectionCreated",
      "desktop.connectionTestResult",
      "desktop.sftpUploadComplete",
    ]);
  });

  it("formats duplicate, edit, delete, and group toast copy through the translator", () => {
    expect(duplicateConnectionName(t, "prod-edge-01")).toBe('desktop.connectionCopyName:{"name":"prod-edge-01"}');
    expect(duplicateConnectionName(t, "prod-edge-01", 2)).toBe('desktop.connectionCopyNameNumbered:{"name":"prod-edge-01","number":2}');
    expect(connectionDuplicatedToast(t, "prod-edge-01 copy")).toBe('desktop.connectionDuplicated:{"name":"prod-edge-01 copy"}');
    expect(connectionEditedToast(t, "prod-edge-01")).toBe('desktop.connectionEdited:{"name":"prod-edge-01"}');
    expect(connectionDeletedToast(t, "prod-edge-01")).toBe('desktop.connectionDeleted:{"name":"prod-edge-01"}');
    expect(groupCreatedToast(t, "Prod")).toBe('desktop.groupCreatedToast:{"name":"Prod"}');
    expect(groupDeletedToast(t, "Prod")).toBe('desktop.groupDeletedToast:{"name":"Prod"}');
    expect(groupRenamedToast(t, "Prod")).toBe('desktop.groupRenamedToast:{"name":"Prod"}');
    expect(sshCommandCopiedToast(t, "prod-edge-01")).toBe('desktop.sshCommandCopied:{"name":"prod-edge-01"}');
  });

  it("uses dedicated warning messages for built-in demo connections", () => {
    expect(builtinConnectionEditUnavailableToast(t)).toBe("desktop.builtinConnectionEditUnavailable");
    expect(builtinConnectionDeleteUnavailableToast(t)).toBe("desktop.builtinConnectionDeleteUnavailable");
    expect(sshCommandCopyFailedToast(t)).toBe("desktop.sshCommandCopyFailed");
  });
});
