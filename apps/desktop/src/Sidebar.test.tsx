// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocaleFormatters } from "@atlasterm/i18n";
import { Sidebar } from "./Sidebar";
import type { DesktopConnection } from "./main";

const t = ((key: string) => key) as any;
const formatters = createLocaleFormatters("en");

const conns: DesktopConnection[] = [
  {
    name: "prod-edge-01",
    host: "10.48.12.11",
    group: "Production",
    status: "sample",
    latencyLabelKey: "desktop.sampleDataShort",
    color: "neutral",
    tags: ["sample"],
  },
  {
    name: "eu-build-runner",
    host: "172.19.0.44",
    group: "CI runners",
    status: "busy",
    latencyMs: 72,
    color: "warn",
    tags: ["ci"],
    latencyHistory: [72],
  },
  {
    name: "db-replica-03",
    host: "db3.internal",
    group: "Data",
    status: "locked",
    latencyLabelKey: "desktop.mfaRequiredShort",
    color: "premium",
    tags: ["database"],
  },
] as unknown as DesktopConnection[];

function setup(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const grouped = new Map<string, DesktopConnection[]>([
    ["Production", [conns[0]]],
    ["CI runners", [conns[1]]],
    ["Data", [conns[2]]],
  ]);
  const props: React.ComponentProps<typeof Sidebar> = {
    activeConnectionName: "prod-edge-01",
    activeTagFilters: new Set<string>(),
    allGroupNames: ["Production", "CI runners", "Data"],
    allTags: ["gateway", "ci", "database"],
    commandSnippets: [
      { nameKey: "desktop.snippetPodStatus", command: "kubectl get pods" },
    ],
    collapsedGroups: new Set<string>(),
    connectionCounts: { Production: 1, "CI runners": 1, Data: 1 },
    direction: "ltr",
    effectiveConnections: conns,
    favorites: ["prod-edge-01"],
    filteredConnections: conns,
    formatters,
    groupedConnections: grouped,
    groupOrder: ["Production", "CI runners", "Data"],
    languageChoice: "auto",
    locale: "en",
    onActivateConnection: vi.fn(),
    onCommandInputChange: vi.fn(),
    onGroupDispatch: vi.fn(),
    onLanguageChoiceChange: vi.fn(),
    onOpenPalette: vi.fn(),
    onSidebarSearchChange: vi.fn(),
    onTagFilterToggle: vi.fn(),
    onToggleFavorite: vi.fn(),
    onContextMenu: vi.fn(),
    sidebarSearch: "",
    t,
    dragState: {
      order: conns.map((c) => c.name),
      dragging: null,
      dragOver: null,
    },
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDragEnd: vi.fn(),
    onMoveConnectionAfter: vi.fn(),
    onMoveConnectionBefore: vi.fn(),
    onToggleCollapsed: vi.fn(),
    ...overrides,
  } as React.ComponentProps<typeof Sidebar>;
  render(<Sidebar {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe("Sidebar", () => {
  it("renders grouped connections with latency and status states", () => {
    setup();
    expect(screen.getByText("prod-edge-01")).toBeTruthy();
    expect(screen.getByText("eu-build-runner")).toBeTruthy();
    expect(screen.getByText("db-replica-03")).toBeTruthy();
    expect(screen.getByText("desktop.sampleDataShort")).toBeTruthy();
    // locked connection uses its localized latency label key
    expect(screen.getByText("desktop.mfaRequiredShort")).toBeTruthy();
  });

  it("activates a connection when its card is clicked", () => {
    const props = setup();
    const connectionButton = screen.getByRole("button", {
      name: /prod-edge-01/i,
    });
    expect(connectionButton.getAttribute("data-tooltip")).toBe(
      "prod-edge-01 \u2014 10.48.12.11",
    );
    fireEvent.click(connectionButton);
    expect(props.onActivateConnection).toHaveBeenCalledWith("prod-edge-01");
  });

  it("marks only the active connection as current", () => {
    setup();
    expect(
      screen
        .getByRole("button", { name: /prod-edge-01/i })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /eu-build-runner/i })
        .hasAttribute("aria-current"),
    ).toBe(false);
  });

  it("labels status dots by connection status instead of color", () => {
    setup();

    expect(
      document
        .querySelector(".status-dot--neutral")
        ?.getAttribute("aria-label"),
    ).toBe("desktop.sampleDataShort");
    expect(
      document.querySelector(".status-dot--warn")?.getAttribute("aria-label"),
    ).toBe("desktop.connectionBusy");
    expect(
      document
        .querySelector(".status-dot--premium")
        ?.getAttribute("aria-label"),
    ).toBe("desktop.locked");
    expect(screen.queryByLabelText("desktop.connectionHealthy")).toBeNull();
  });

  it("toggles a tag filter", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "gateway" }));
    expect(props.onTagFilterToggle).toHaveBeenCalledWith("gateway");
  });

  it("toggles favorite from a connection card", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText("desktop.removeFromFavorites"));
    expect(props.onToggleFavorite).toHaveBeenCalledWith("prod-edge-01");
  });

  it("collapses a group via its header", () => {
    const props = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /desktop.groupProduction/ }),
    );
    expect(props.onGroupDispatch).toHaveBeenCalledWith({
      type: "TOGGLE_COLLAPSE",
      group: "Production",
    });
  });

  it("loads a snippet command on click", () => {
    const props = setup();
    fireEvent.click(screen.getByText("desktop.snippetPodStatus"));
    expect(props.onCommandInputChange).toHaveBeenCalledWith("kubectl get pods");
  });

  it("updates the sidebar search value", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("desktop.searchPlaceholder"), {
      target: { value: "db" },
    });
    expect(props.onSidebarSearchChange).toHaveBeenCalledWith("db");
  });

  it("exposes a persistent control for collapsing and restoring the sidebar", () => {
    const props = setup();
    const toggle = screen.getByLabelText("desktop.toggleSidebar");
    expect(toggle.getAttribute("aria-controls")).toBe("desktop-sidebar");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(props.onToggleCollapsed).toHaveBeenCalledOnce();

    cleanup();
    setup({ collapsed: true, onToggleCollapsed: props.onToggleCollapsed });
    expect(
      screen
        .getByLabelText("desktop.toggleSidebar")
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("renders an empty state when no connections match", () => {
    setup({
      filteredConnections: [],
      groupedConnections: new Map(),
      groupOrder: [],
    });
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("opens the group manager and the command palette from the action bar", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText("desktop.manageGroups"));
    expect(props.onGroupDispatch).toHaveBeenCalledWith({
      type: "SET_MANAGER_OPEN",
      open: true,
    });
    fireEvent.click(screen.getByLabelText("desktop.commandPalette"));
    expect(props.onOpenPalette).toHaveBeenCalledWith();
  });

  it("fires drag and context-menu handlers on a connection card", () => {
    const props = setup();
    const card = screen.getByRole("button", { name: /prod-edge-01/i });
    fireEvent.dragStart(card);
    fireEvent.dragOver(card);
    fireEvent.dragLeave(card);
    fireEvent.dragEnd(card);
    fireEvent.contextMenu(card);
    expect(props.onDragStart).toHaveBeenCalledWith("prod-edge-01");
    expect(props.onDragOver).toHaveBeenCalledWith("prod-edge-01");
    expect(props.onDragLeave).toHaveBeenCalled();
    expect(props.onDragEnd).toHaveBeenCalled();
    expect(props.onContextMenu).toHaveBeenCalled();
  });

  it("moves focused connections with Alt+Arrow keyboard shortcuts", () => {
    const prodConnections = [
      conns[0],
      { ...conns[0], name: "prod-edge-02", host: "10.48.12.12" },
    ] as DesktopConnection[];
    const props = setup({
      effectiveConnections: prodConnections,
      filteredConnections: prodConnections,
      groupedConnections: new Map([["Production", prodConnections]]),
      groupOrder: ["Production"],
      dragState: {
        order: prodConnections.map((c) => c.name),
        dragging: null,
        dragOver: null,
      },
      favorites: [],
    });
    const first = screen.getByRole("button", { name: /prod-edge-01/i });
    const second = screen.getByRole("button", { name: /prod-edge-02/i });

    expect(first.getAttribute("aria-keyshortcuts")).toBe(
      "Alt+ArrowUp Alt+ArrowDown",
    );
    fireEvent.keyDown(second, { key: "ArrowUp", altKey: true });
    expect(props.onMoveConnectionBefore).toHaveBeenCalledWith(
      "prod-edge-02",
      "prod-edge-01",
    );

    fireEvent.keyDown(first, { key: "ArrowDown", altKey: true });
    expect(props.onMoveConnectionAfter).toHaveBeenCalledWith(
      "prod-edge-01",
      "prod-edge-02",
    );
  });

  it("does not move focused connections past group boundaries", () => {
    const prodConnections = [
      conns[0],
      { ...conns[0], name: "prod-edge-02", host: "10.48.12.12" },
    ] as DesktopConnection[];
    const props = setup({
      effectiveConnections: prodConnections,
      filteredConnections: prodConnections,
      groupedConnections: new Map([["Production", prodConnections]]),
      groupOrder: ["Production"],
      dragState: {
        order: prodConnections.map((c) => c.name),
        dragging: null,
        dragOver: null,
      },
      favorites: [],
    });

    fireEvent.keyDown(screen.getByRole("button", { name: /prod-edge-01/i }), {
      key: "ArrowUp",
      altKey: true,
    });
    fireEvent.keyDown(screen.getByRole("button", { name: /prod-edge-02/i }), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(props.onMoveConnectionBefore).not.toHaveBeenCalled();
    expect(props.onMoveConnectionAfter).not.toHaveBeenCalled();
  });

  it("hides items of a collapsed group", () => {
    setup({ collapsedGroups: new Set(["Production"]) });
    expect(screen.queryByText("prod-edge-01")).toBeNull();
    // other groups still render
    expect(screen.getByText("eu-build-runner")).toBeTruthy();
  });

  it("renders a custom group label verbatim when not in the builtin key map", () => {
    const custom = new Map([["My Custom", [conns[0]]]]);
    setup({
      groupedConnections: custom,
      groupOrder: ["My Custom"],
      allGroupNames: ["My Custom"],
    });
    expect(screen.getByText("My Custom")).toBeTruthy();
  });

  it("renders custom latency labels verbatim when no latency key is provided", () => {
    const customLatency = [
      {
        name: "db-replica-03",
        host: "db3.internal",
        group: "Data",
        status: "locked",
        latencyLabel: "External MFA",
        color: "premium",
        tags: ["database"],
      },
    ] as unknown as DesktopConnection[];
    setup({
      effectiveConnections: customLatency,
      filteredConnections: customLatency,
      groupedConnections: new Map([["Data", customLatency]]),
      groupOrder: ["Data"],
      favorites: [],
    });
    expect(screen.getByText("External MFA")).toBeTruthy();
  });

  it("renders translated latency keys through the provided translator", () => {
    const translated = ((key: string) =>
      key === "desktop.mfaRequiredShort" ? "MFA required" : key) as any;
    setup({ t: translated });
    expect(screen.getByText("MFA required")).toBeTruthy();
  });

  it("prioritizes numeric latency over latency labels", () => {
    const withLatency = [
      {
        name: "prod-edge-01",
        host: "10.48.12.11",
        group: "Production",
        status: "online",
        latencyMs: 12,
        latencyLabelKey: "desktop.mfaRequiredShort",
        color: "good",
        tags: [],
      },
    ] as unknown as DesktopConnection[];
    setup({
      effectiveConnections: withLatency,
      filteredConnections: withLatency,
      groupedConnections: new Map([["Production", withLatency]]),
      groupOrder: ["Production"],
      favorites: [],
    });
    expect(screen.getByText("12 ms")).toBeTruthy();
    expect(screen.queryByText("desktop.mfaRequiredShort")).toBeNull();
  });

  it("shows a localized latency fallback for a connection without latency data", () => {
    const noLatency = [
      {
        name: "prod-edge-01",
        host: "10.48.12.11",
        group: "Production",
        status: "online",
        color: "good",
        tags: [],
      },
    ] as unknown as DesktopConnection[];
    setup({
      effectiveConnections: noLatency,
      filteredConnections: noLatency,
      groupedConnections: new Map([["Production", noLatency]]),
      groupOrder: ["Production"],
      favorites: [],
    });
    expect(screen.getByText("desktop.notAvailable")).toBeTruthy();
  });
});
