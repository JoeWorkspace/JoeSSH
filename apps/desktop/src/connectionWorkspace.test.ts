import { describe, expect, it } from "vitest";
import {
  addTerminalTab,
  createQuickConnectionProfile,
  findConnectionNameByTarget,
  getConnectionPresence,
  getConnectionTarget,
  getTerminalTabIndex,
  matchesSidebarSearch,
  removeTerminalTab,
} from "./connectionWorkspace";

describe("connection workspace state", () => {
  it("keeps a profile in sample state until a real session exists", () => {
    expect(getConnectionPresence(undefined)).toEqual({
      color: "neutral",
      status: "sample",
    });
    expect(getConnectionPresence("session-42")).toEqual({
      color: "good",
      status: "online",
    });
  });

  it("opens and selects a connection tab without duplicating it", () => {
    const initialTabs = ["prod-edge-01", "staging-api"];
    const opened = addTerminalTab(
      initialTabs,
      "customer-edge-with-a-long-profile-name",
    );
    const reopened = addTerminalTab(
      opened,
      "customer-edge-with-a-long-profile-name",
    );

    expect(opened).toEqual([
      "prod-edge-01",
      "staging-api",
      "customer-edge-with-a-long-profile-name",
    ]);
    expect(reopened).toEqual(opened);
    expect(
      getTerminalTabIndex(reopened, "customer-edge-with-a-long-profile-name"),
    ).toBe(2);
  });

  it("removes deleted connection tabs without mutating the original list", () => {
    const tabs = ["prod-edge-01", "temporary-host"];

    expect(removeTerminalTab(tabs, "temporary-host")).toEqual(["prod-edge-01"]);
    expect(tabs).toEqual(["prod-edge-01", "temporary-host"]);
  });

  it("preserves imported target overrides and matches equivalent quick targets", () => {
    expect(
      getConnectionTarget({
        host: "fallback@edge.internal:2200",
        port: 2222,
        username: "release",
      }),
    ).toEqual({
      host: "edge.internal",
      port: 2222,
      username: "release",
    });
    expect(
      findConnectionNameByTarget(
        [
          {
            host: "edge.internal",
            name: "customer-edge",
            port: 2222,
            username: "release",
          },
        ],
        { host: "edge.internal", port: 2222, username: "release" },
      ),
    ).toBe("customer-edge");
  });

  it("creates a uniquely named sample profile for an unmatched quick target", () => {
    expect(
      createQuickConnectionProfile(
        { host: "edge.internal", port: 2200, username: "atlas" },
        ["atlas@edge.internal:2200", "atlas@edge.internal:2200 (2)"],
        "Quick connect",
      ),
    ).toEqual({
      color: "neutral",
      group: "Quick connect",
      host: "edge.internal",
      name: "atlas@edge.internal:2200 (3)",
      port: 2200,
      status: "sample",
      tags: ["ssh"],
      username: "atlas",
    });
  });

  it.each([
    ["name", "edge"],
    ["host", "10.48"],
    ["username", "release"],
    ["raw group", "production"],
    ["localized group", "生产"],
    ["tag", "gateway"],
  ])("matches sidebar search by %s", (_field, query) => {
    const connection = {
      group: "Production",
      host: "10.48.12.11",
      name: "edge-primary",
      tags: ["gateway", "ssh"],
      username: "release",
    };

    expect(matchesSidebarSearch(connection, query, "生产环境")).toBe(true);
  });

  it("trims sidebar search and rejects unrelated values", () => {
    const connection = {
      group: "Production",
      host: "10.48.12.11",
      name: "edge-primary",
      tags: ["gateway"],
      username: "release",
    };

    expect(matchesSidebarSearch(connection, "  RELEASE  ")).toBe(true);
    expect(matchesSidebarSearch(connection, "billing")).toBe(false);
  });
});
