import { describe, expect, it } from "vitest";
import { isKeyboardShortcutsToggle } from "./keyboardShortcuts";

function event(overrides: Partial<Parameters<typeof isKeyboardShortcutsToggle>[0]> = {}) {
  return {
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("keyboard shortcut helpers", () => {
  it("accepts the literal question-mark shortcut event", () => {
    expect(isKeyboardShortcutsToggle(event({ ctrlKey: true, key: "?", shiftKey: true }))).toBe(true);
  });

  it("accepts shifted slash events emitted by browser automation and some layouts", () => {
    expect(isKeyboardShortcutsToggle(event({ ctrlKey: true, key: "/", shiftKey: true }))).toBe(true);
    expect(isKeyboardShortcutsToggle(event({ code: "Slash", ctrlKey: true, key: "", shiftKey: true }))).toBe(true);
  });

  it("supports the platform meta modifier", () => {
    expect(isKeyboardShortcutsToggle(event({ key: "?", metaKey: true, shiftKey: true }))).toBe(true);
  });

  it("rejects partial or unrelated shortcuts", () => {
    expect(isKeyboardShortcutsToggle(event({ ctrlKey: true, key: "?", shiftKey: false }))).toBe(false);
    expect(isKeyboardShortcutsToggle(event({ ctrlKey: true, key: "T", shiftKey: true }))).toBe(false);
    expect(isKeyboardShortcutsToggle(event({ key: "?", shiftKey: true }))).toBe(false);
  });
});
