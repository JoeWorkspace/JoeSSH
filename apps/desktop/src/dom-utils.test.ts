// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { getActiveElement } from "./dom-utils";

describe("getActiveElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the currently active element or null", () => {
    const result = getActiveElement();
    expect(result === null || result instanceof HTMLElement).toBe(true);
  });

  it("returns the focused element", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    expect(getActiveElement()).toBe(button);
  });

  it("returns input when input is focused", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(getActiveElement()).toBe(input);
  });
});
