import { describe, expect, it } from "vitest";

// main.tsx is the entry point that calls createRoot().render() at the module level.
// We can't import it directly in tests (it would try to render to DOM).
// Instead, test that the module structure is valid.

describe("main entry point", () => {
  it("has a valid HTML entry point", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const htmlPath = path.resolve(__dirname, "../index.html");
    const html = fs.readFileSync(htmlPath, "utf-8");
    expect(html).toContain('<div id="root">');
    expect(html).toContain('src="/src/main.tsx"');
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toContain("frame-ancestors");
    expect(html).toContain("manifest.json");
  });

  it("main.tsx exists and is a valid module file", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");
    expect(content).toContain("createRoot");
    expect(content).toContain("App");
  });

  it("keeps the topbar demo/no-session scope label localized", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain('t("desktop.demoScopeSummary")');
    expect(content).not.toContain("Production / gateway fleet");
  });

  it("does not seed built-in desktop profiles as online production hosts", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain('status: "sample"');
    expect(content).toContain(
      "Sample fixture transcript - no SSH session is connected.",
    );
    expect(content).not.toContain('statusLabel={t("desktop.live")}');
  });

  it("derives profile status from native sessions and renders stateful terminal tabs", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain(
      "getConnectionPresence(desktopSessionsRef.current[connection.name])",
    );
    expect(content).toContain("openTerminalTabs.map((tab)");
    expect(content).toContain("openConnectionTab(connection.name)");
    expect(content).not.toContain(
      'status: "online",\n        color: "neutral"',
    );
    expect(content).not.toContain("index === activeTab ? <X");
  });

  it("keeps the SFTP panel tab label localized", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain('label: t("desktop.sftp")');
    expect(content).not.toContain('label: "SFTP"');
  });

  it("keeps telemetry default-off and versioned for Public Beta", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain("VITE_ATLASTERM_TELEMETRY_OPT_IN");
    expect(content).toContain("createNoopErrorMonitor");
    expect(content).toContain("0.1.0-beta.11");
    expect(content).not.toContain("version: '0.1.0'");
    expect(content).not.toContain('version: "0.1.0"');
  });

  it("wires runtime telemetry disable to clean up transport", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain("setTelemetryEnabled");
    expect(content).toContain("errorMonitor.install()");
    expect(content).toContain("uninstall?.()");
    expect(content).toContain("errorMonitor.disable()");
    expect(content).toContain("setTelemetryEnabled(nextEnabled)");
  });

  it("wires desktop disconnect through IPC and clears the active session state", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain("sshDisconnect");
    expect(content).toContain('command: "disconnect"');
    expect(content).toContain("await sshDisconnect(sessionId)");
    expect(content).toContain(
      "delete desktopSessionsRef.current[activeConnection.name]",
    );
    expect(content).toContain("setConnectVersion((version) => version + 1)");
    expect(content).toContain('{ ...activeConnection, status: "sample" }');
    expect(content).toContain("void handleDisconnect().then((didDisconnect)");
    expect(content).toContain('{t("desktop.disconnect")}');
  });

  it("opens Connect modal with parsed Quick Connect defaults", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain("connectTargetOverride");
    expect(content).toContain(
      "const target = splitConnectionTarget(item.sub ?? paletteState.input)",
    );
    expect(content).toContain("setConnectTargetOverride(target)");
    expect(content).toContain("setConnectOpen(true)");
    expect(content).toContain("defaultPort={connectDefaults.port}");
    expect(content).toContain("setConnectTargetOverride(null)");
    expect(content).toContain("setConnectProfileName(connectionName)");
    expect(content).toContain(
      "desktopSessionsRef.current[connectionName] = sessionId",
    );
  });

  it("wires every public PWA shortcut to an implemented launch intent", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain("parseDesktopLaunchIntent");
    expect(content).toContain("launchIntent.panel ?? storedLayout.rightPanel");
    expect(content).toContain("useState(launchIntent.connect)");
  });

  it("joins SFTP transfer paths through safe listing entry names", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain("joinSftpRemoteEntryPath");
    expect(content).toContain("async function handleSftpDownload(");
    expect(content).toContain("async function handleSftpUploadFile(");
    expect(content).toContain("directoryPath = sftpDirectory.path");
    expect(content).toContain("joinSftpRemoteEntryPath(directoryPath, name)");
    expect(content).toContain(
      "joinSftpRemoteEntryPath(directoryPath, file.name)",
    );
    expect(content).not.toContain("joinSftpRemotePath(sftpDirectory.path");
  });

  it("surfaces invalid connection imports instead of reporting zero imported connections", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mainPath = path.resolve(__dirname, "./main.tsx");
    const content = fs.readFileSync(mainPath, "utf-8");

    expect(content).toContain("connectionsImportFailedToast");
    expect(content).toContain("if (!list)");
    expect(content).toContain("if (added === 0)");
    expect(content).toContain("onImportError: () =>");
    expect(content).toContain(
      'addToast(connectionsImportFailedToast(t), "error")',
    );
  });
});
