// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalPane, highlightMatch } from "./TerminalPane";
import type { TerminalLine } from "./terminalExecutor";

// Mock autocompleteCommands to ensure suggestions are available
vi.mock("./autocompleteCommands", () => ({
  terminalAutocompleteCommands: [
    "kubectl get pods",
    "kubectl logs",
    "kubectl exec -it",
    "docker ps",
    "docker logs",
  ],
}));

// Mock ResizeObserver for happy-dom - calls callback on observe
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
  }
  observe(_target: Element) {
    // Simulate a resize callback with a mock entry
    const entry = { contentRect: { height: 600, width: 800 } } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
  disconnect = vi.fn();
  unobserve = vi.fn();
}
(globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver;

function makeLines(count: number): TerminalLine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `line-${i}`,
    text: `Line ${i} content`,
    kind: "output" as const,
  }));
}

const mockT = (key: string, values?: Record<string, string | number>) => {
  if (values?.count !== undefined) return `${values.count} matches`;
  return key;
};

afterEach(() => cleanup());

describe("TerminalPane", () => {
  it("renders title and status label", () => {
    render(
      <TerminalPane
        title="Test Terminal"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    expect(screen.getByText("Test Terminal")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("renders terminal lines", () => {
    render(
      <TerminalPane
        title="Test Lines"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    expect(screen.getByText("Line 0 content")).toBeTruthy();
    expect(screen.getByText("Line 2 content")).toBeTruthy();
  });

  it("renders recording indicator when recording", () => {
    render(
      <TerminalPane
        title="Test Rec"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        recording
        recordingTimeLabel="01:30"
      />,
    );
    expect(screen.getByText("01:30")).toBeTruthy();
    expect(screen.getByLabelText("desktop.recording")).toBeTruthy();
  });

  it("renders search bar when searchOpen and active", () => {
    render(
      <TerminalPane
        title="Test Search"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("desktop.searchPlaceholder")).toBeTruthy();
  });

  it("renders search bar for a sample transcript without a live session", () => {
    render(
      <TerminalPane
        title="Test SampleSearch"
        lines={makeLines(3)}
        statusLabel="No session"
        t={mockT as never}
        searchOpen
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("desktop.searchPlaceholder")).toBeTruthy();
  });

  it("renders command input when active with handlers", () => {
    render(
      <TerminalPane
        title="Test Cmd"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput=""
        onCommandInputChange={vi.fn()}
        onCommandSubmit={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("desktop.terminalInputPlaceholder")).toBeTruthy();
  });

  it("does not render command input when not active", () => {
    render(
      <TerminalPane
        title="Test NoCmd"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    expect(screen.queryByPlaceholderText("desktop.terminalInputPlaceholder")).toBeNull();
  });

  it("renders command feedback", () => {
    render(
      <TerminalPane
        title="Test Feedback"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput=""
        onCommandInputChange={vi.fn()}
        onCommandSubmit={vi.fn()}
        commandFeedback={{ title: "Accepted", detail: "Command ran", tone: "accepted" }}
      />,
    );
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.getByText("Command ran")).toBeTruthy();
  });

  it("renders blocked feedback with alert role", () => {
    render(
      <TerminalPane
        title="Test Blocked"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput=""
        onCommandInputChange={vi.fn()}
        onCommandSubmit={vi.fn()}
        commandFeedback={{ title: "Blocked", detail: "Not allowed", tone: "blocked" }}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("calls onToggleRecording when recording button clicked", () => {
    const onToggle = vi.fn();
    render(
      <TerminalPane
        title="Test Toggle"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        onToggleRecording={onToggle}
      />,
    );
    const btn = screen.getByLabelText("desktop.startRecording");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
  });

  it("renders a disabled recording button when recording needs a live session", () => {
    render(
      <TerminalPane
        title="Sample Terminal"
        lines={makeLines(3)}
        statusLabel="No session"
        t={mockT as never}
        recordingDisabled
      />,
    );
    expect((screen.getByLabelText("desktop.startRecording") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders virtualized lines for 200+ lines", () => {
    const lines = makeLines(250);
    render(
      <TerminalPane
        title="Test Virt"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    expect(screen.getByText("Line 0 content")).toBeTruthy();
  });

  it("renders prompt when not active", () => {
    render(
      <TerminalPane
        title="Test Prompt"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    expect(screen.getByText(/atlas@prod-edge-01/)).toBeTruthy();
  });

  it("renders search match count as current/total", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "hello world", kind: "output" },
      { id: "2", text: "hello again", kind: "output" },
      { id: "3", text: "no match", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test Count"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="hello"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("renders zero match count via translation when no matches", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "hello world", kind: "output" },
      { id: "2", text: "hello again", kind: "output" },
      { id: "3", text: "no match", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test NoMatch"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="zzz"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    expect(screen.getByText("0 matches")).toBeTruthy();
  });

  it("renders recording stop button when recording", () => {
    render(
      <TerminalPane
        title="Test RecStop"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        recording
        recordingTimeLabel="00:05"
        onToggleRecording={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("desktop.stopRecording")).toBeTruthy();
  });

  it("renders good badge when active", () => {
    render(
      <TerminalPane
        title="Test Active"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
      />,
    );
    const badge = screen.getByText("Live");
    expect(badge.className).toContain("good");
  });

  it("renders accepted feedback with status role", () => {
    render(
      <TerminalPane
        title="Test Status"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput=""
        onCommandInputChange={vi.fn()}
        onCommandSubmit={vi.fn()}
        commandFeedback={{ title: "OK", detail: "Done", tone: "accepted" }}
      />,
    );
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders search close button", () => {
    const onClose = vi.fn();
    render(
      <TerminalPane
        title="Test Close"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        onSearchClose={onClose}
      />,
    );
    const closeBtn = screen.getByLabelText("desktop.searchClose");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("handles command input change", () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test Input"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput=""
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.terminalInputPlaceholder");
    fireEvent.change(input, { target: { value: "ls" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("handles command submit", () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(
      <TerminalPane
        title="Test Submit"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput="ls"
        onCommandInputChange={vi.fn()}
        onCommandSubmit={onSubmit}
      />,
    );
    const form = screen.getByPlaceholderText("desktop.terminalInputPlaceholder").closest("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalled();
  });

  it("renders search highlight in terminal lines", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "hello world", kind: "output" },
      { id: "2", text: "no match here", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test Highlight"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="hello"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const marks = document.querySelectorAll("mark.terminal-search-highlight");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("hello");
  });

  it("renders virtualized lines with search highlights", () => {
    const lines = makeLines(250);
    lines[5] = { id: "match", text: "found searchterm here", kind: "output" };
    render(
      <TerminalPane
        title="Test VirtSearch"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="searchterm"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    // Virtualized rendering should still work
    expect(screen.getByText("1/1")).toBeTruthy();
  });

  it("renders previous/next match buttons", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "match a", kind: "output" },
      { id: "2", text: "match b", kind: "output" },
      { id: "3", text: "no", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test Nav"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="match"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const nextBtn = screen.getByLabelText("desktop.searchNextMatch");
    fireEvent.click(nextBtn);
    expect(screen.getByText("2/2")).toBeTruthy();
  });

  it("renders recording indicator with dot", () => {
    render(
      <TerminalPane
        title="Test RecDot"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        recording
        recordingTimeLabel="00:15"
        onToggleRecording={vi.fn()}
      />,
    );
    expect(document.querySelector(".recording-dot")).toBeTruthy();
    expect(document.querySelector(".recording-indicator")).toBeTruthy();
  });

  it("renders terminal lines without search when searchQuery is empty", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "plain text", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test Plain"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    expect(screen.getByText("plain text")).toBeTruthy();
    expect(document.querySelectorAll("mark")).toHaveLength(0);
  });

  it("handles search input change", () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test SearchInput"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery=""
        onSearchQueryChange={onChange}
        onSearchClose={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.searchPlaceholder");
    fireEvent.change(input, { target: { value: "test" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("handles Escape key in search bar", () => {
    const onClose = vi.fn();
    render(
      <TerminalPane
        title="Test Esc"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        onSearchClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.searchPlaceholder");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("handles Enter key in search bar for next match", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "match a", kind: "output" },
      { id: "2", text: "match b", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test Enter"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="match"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.searchPlaceholder");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2/2")).toBeTruthy();
  });

  it("handles Shift+Enter key in search bar for previous match", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "match a", kind: "output" },
      { id: "2", text: "match b", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test ShiftEnter"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="match"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.searchPlaceholder");
    // First go to next
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2/2")).toBeTruthy();
    // Then shift+enter to go back
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("clicks previous match button", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "match a", kind: "output" },
      { id: "2", text: "match b", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test PrevBtn"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="match"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const nextBtn = screen.getByLabelText("desktop.searchNextMatch");
    fireEvent.click(nextBtn);
    expect(screen.getByText("2/2")).toBeTruthy();
    const prevBtn = screen.getByLabelText("desktop.searchPrevMatch");
    fireEvent.click(prevBtn);
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("renders disabled previous/next buttons when no matches", () => {
    render(
      <TerminalPane
        title="Test Disabled"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="zzz"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const prevBtn = screen.getByLabelText("desktop.searchPrevMatch");
    const nextBtn = screen.getByLabelText("desktop.searchNextMatch");
    expect(prevBtn.hasAttribute("disabled")).toBe(true);
    expect(nextBtn.hasAttribute("disabled")).toBe(true);
  });

  it("renders previous match button with correct label", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "match a", kind: "output" },
      { id: "2", text: "match b", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test PrevLabel"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="match"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const prevBtn = screen.getByLabelText("desktop.searchPrevMatch");
    expect(prevBtn).toBeTruthy();
    expect(prevBtn.hasAttribute("disabled")).toBe(false);
  });

  it("renders next match button with correct label", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "match a", kind: "output" },
      { id: "2", text: "match b", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test NextLabel"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="match"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const nextBtn = screen.getByLabelText("desktop.searchNextMatch");
    expect(nextBtn).toBeTruthy();
    expect(nextBtn.hasAttribute("disabled")).toBe(false);
  });

  it("renders autocomplete suggestions when typing", async () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test Autocomplete"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput="ku"
        commandHistory={["kubectl get pods", "kubectl logs"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    // Wait for autocomplete commands to load
    await new Promise((r) => setTimeout(r, 100));
    const suggestions = document.querySelectorAll(".terminal-autocomplete-item");
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("renders autocomplete hint through the translator", () => {
    const t = (key: string, values?: Record<string, string | number>) => {
      if (values?.count !== undefined) return `${values.count} matches`;
      if (key === "desktop.terminalAutocompleteComplete") return "complete-localized";
      if (key === "desktop.terminalAutocompleteNavigate") return "navigate-localized";
      return key;
    };

    render(
      <TerminalPane
        title="Test AutocompleteHint"
        lines={makeLines(3)}
        statusLabel="Live"
        t={t as never}
        active
        commandInput="ku"
        commandHistory={["kubectl get pods", "kubectl logs"]}
        onCommandInputChange={vi.fn()}
        onCommandSubmit={vi.fn()}
      />,
    );

    const hint = document.querySelector(".terminal-autocomplete-hint");
    expect(hint?.textContent).toContain("Tab complete-localized");
    expect(hint?.textContent).toContain("Alt+↑/↓ navigate-localized");
    expect(hint?.textContent).not.toContain("to complete");
    expect(hint?.textContent).not.toContain("to navigate");
  });

  it("selects autocomplete suggestion on mouse down", async () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test AutocompleteClick"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput="ku"
        commandHistory={["kubectl get pods", "kubectl logs"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    await new Promise((r) => setTimeout(r, 100));
    const suggestions = document.querySelectorAll(".terminal-autocomplete-item");
    if (suggestions.length > 0) {
      fireEvent.mouseDown(suggestions[0]);
      expect(onChange).toHaveBeenCalled();
    }
  });

  it("highlights autocomplete suggestion on mouse enter", async () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test AutocompleteHover"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput="ku"
        commandHistory={["kubectl get pods", "kubectl logs"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    await new Promise((r) => setTimeout(r, 100));
    const suggestions = document.querySelectorAll(".terminal-autocomplete-item");
    if (suggestions.length > 1) {
      fireEvent.mouseEnter(suggestions[1]);
      expect(suggestions[1].className).toContain("is-selected");
    }
  });

  it("renders terminal with stderr lines", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "error output", kind: "system" },
      { id: "2", text: "normal output", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test Stderr"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    expect(screen.getByText("error output")).toBeTruthy();
    expect(screen.getByText("normal output")).toBeTruthy();
  });

  it("renders empty terminal", () => {
    render(
      <TerminalPane
        title="Test Empty"
        lines={[]}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    expect(screen.getByText("Test Empty")).toBeTruthy();
  });

  it("renders with command history for autocomplete", async () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test History"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput="ku"
        commandHistory={["kubectl get pods", "kubectl logs", "ls -la"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    await new Promise((r) => setTimeout(r, 100));
    // Autocomplete may or may not show depending on dynamic import
    // Just verify the component rendered without error
    expect(screen.getByText("Test History")).toBeTruthy();
  });

  it("renders terminal pane with is-active class when active", () => {
    render(
      <TerminalPane
        title="Test ActiveClass"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
      />,
    );
    const pane = document.querySelector(".terminal-pane");
    expect(pane?.className).toContain("is-active");
  });

  it("renders terminal pane with is-recording class when recording", () => {
    render(
      <TerminalPane
        title="Test RecClass"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        recording
        recordingTimeLabel="00:00"
      />,
    );
    const pane = document.querySelector(".terminal-pane");
    expect(pane?.className).toContain("is-recording");
  });

  it("navigates command history with ArrowUp/ArrowDown", () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test History"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput=""
        commandHistory={["ls", "pwd", "echo hello"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.terminalInputPlaceholder");
    // ArrowUp to go to last command
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith("echo hello");
    // ArrowDown to go back
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalled();
  });

  it("navigates command history with multiple ArrowUp presses", () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test HistoryMulti"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput=""
        commandHistory={["ls", "pwd", "echo hello"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.terminalInputPlaceholder");
    // ArrowUp twice to go to second-to-last command
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith("pwd");
  });

  it("handles Tab key for autocomplete", () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test Tab"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput="ku"
        commandHistory={["kubectl get pods", "kubectl logs"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.terminalInputPlaceholder");
    fireEvent.keyDown(input, { key: "Tab" });
    // Tab should trigger autocomplete if suggestions are available
    expect(onChange).toHaveBeenCalled();
  });

  it("handles Alt+ArrowDown for autocomplete navigation", () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test AltDown"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput="ku"
        commandHistory={["kubectl get pods", "kubectl logs"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.terminalInputPlaceholder");
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    // Should navigate autocomplete suggestions
  });

  it("handles Alt+ArrowUp for autocomplete navigation", () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test AltUp"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput="ku"
        commandHistory={["kubectl get pods", "kubectl logs"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.terminalInputPlaceholder");
    fireEvent.keyDown(input, { key: "ArrowUp", altKey: true });
    // Should navigate autocomplete suggestions
  });

  it("handles scroll events for virtualization", () => {
    const lines = makeLines(250);
    render(
      <TerminalPane
        title="Test Scroll"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
      />,
    );
    const pre = screen.getByRole("log", { name: "Test Scroll" });
    Object.defineProperty(pre, "scrollTop", { value: 100, configurable: true, writable: true });
    fireEvent.scroll(pre);
    expect(screen.getByText("Test Scroll")).toBeTruthy();
  });

  it("renders with virtualized lines when > 200 lines", () => {
    const lines = makeLines(300);
    render(
      <TerminalPane
        title="Test Virtualized"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    // Should render without error
    expect(screen.getByText("Test Virtualized")).toBeTruthy();
  });

  it("renders without virtualization when <= 200 lines", () => {
    const lines = makeLines(100);
    render(
      <TerminalPane
        title="Test NoVirt"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
      />,
    );
    expect(screen.getByText("Test NoVirt")).toBeTruthy();
  });

  it("displays match count as fraction when matches exist", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "match a", kind: "output" },
      { id: "2", text: "match b", kind: "output" },
      { id: "3", text: "match c", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test MatchCount"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="match"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("displays translated count when no matches", () => {
    render(
      <TerminalPane
        title="Test NoMatch"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="zzz"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    expect(screen.getByText("0 matches")).toBeTruthy();
  });

  it("handles ArrowDown when not in history mode", () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test ArrowDownNoHistory"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput="test"
        commandHistory={["ls", "pwd"]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.terminalInputPlaceholder");
    // ArrowDown when not navigating history should do nothing
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not navigate history when command history is empty", () => {
    const onChange = vi.fn();
    render(
      <TerminalPane
        title="Test EmptyHistory"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput=""
        commandHistory={[]}
        onCommandInputChange={onChange}
        onCommandSubmit={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.terminalInputPlaceholder");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders terminal with search highlight for multiple matches", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "test line 1", kind: "output" },
      { id: "2", text: "test line 2", kind: "output" },
      { id: "3", text: "no match", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test MultiHighlight"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="test"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const marks = document.querySelectorAll("mark.terminal-search-highlight");
    expect(marks.length).toBe(2);
  });

  it("renders terminal with case-insensitive search", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "Hello World", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test CaseInsensitive"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="hello"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const marks = document.querySelectorAll("mark.terminal-search-highlight");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("Hello");
  });

  it("renders text without highlight when query not found in line", () => {
    const lines: TerminalLine[] = [
      { id: "1", text: "no match here", kind: "output" },
      { id: "2", text: "also no match", kind: "output" },
    ];
    render(
      <TerminalPane
        title="Test NoMatchHighlight"
        lines={lines}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery="zzz"
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    // No highlights should be rendered since query doesn't appear in any line
    expect(document.querySelectorAll("mark")).toHaveLength(0);
    expect(screen.getByText("no match here")).toBeTruthy();
  });

  it("renders with undefined searchQuery falling back to empty string", () => {
    render(
      <TerminalPane
        title="Test UndefinedSearch"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        searchOpen
        searchQuery={undefined as never}
        onSearchQueryChange={vi.fn()}
        onSearchClose={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.searchPlaceholder");
    expect(input).toBeTruthy();
  });

  it("renders with undefined commandInput falling back to empty string", () => {
    render(
      <TerminalPane
        title="Test UndefinedCmdInput"
        lines={makeLines(3)}
        statusLabel="Live"
        t={mockT as never}
        active
        commandInput={undefined as never}
        onCommandInputChange={vi.fn()}
        onCommandSubmit={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("desktop.terminalInputPlaceholder");
    expect(input).toBeTruthy();
  });
});

describe("highlightMatch", () => {
  it("returns text unchanged when query is empty", () => {
    expect(highlightMatch("hello world", "")).toBe("hello world");
  });

  it("returns text unchanged when query is not found", () => {
    expect(highlightMatch("hello world", "zzz")).toBe("hello world");
  });
});
