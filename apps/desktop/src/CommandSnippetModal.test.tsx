// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandSnippetModal } from "./CommandSnippetModal";
import type { CommandSnippetSaveResult } from "./persistence";

const t = ((key: string) => key) as any;

function setup(
  onSave: (snippet: {
    name: string;
    command: string;
  }) => CommandSnippetSaveResult = vi.fn((): CommandSnippetSaveResult => "saved"),
) {
  const props = {
    onClose: vi.fn(),
    onSave,
    t,
  };
  render(<CommandSnippetModal {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe("CommandSnippetModal", () => {
  it("focuses the name field and saves trimmed values", () => {
    const props = setup();
    const name = screen.getByLabelText("desktop.snippetName");
    const command = screen.getByLabelText("desktop.snippetCommand");

    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "  Deploy  " } });
    fireEvent.change(command, {
      target: { value: "  systemctl status sshd  " },
    });
    fireEvent.click(screen.getByText("desktop.snippetSave"));

    expect(props.onSave).toHaveBeenCalledWith({
      name: "Deploy",
      command: "systemctl status sshd",
    });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("rejects control characters before calling the save handler", () => {
    const onSave = vi.fn(
      (_snippet: { name: string; command: string }): CommandSnippetSaveResult =>
        "validation",
    );
    setup(onSave);
    fireEvent.change(screen.getByLabelText("desktop.snippetName"), {
      target: { value: "Unsafe" },
    });
    fireEvent.change(screen.getByLabelText("desktop.snippetCommand"), {
      target: { value: "echo\u0000ok" },
    });
    fireEvent.click(screen.getByText("desktop.snippetSave"));

    expect(screen.getByRole("alert").textContent).toContain(
      "desktop.snippetValidation",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows duplicate and limit errors returned by the owner", () => {
    const onSave = vi
      .fn(
        (_snippet: { name: string; command: string }): CommandSnippetSaveResult =>
          "duplicate",
      )
      .mockReturnValueOnce("duplicate")
      .mockReturnValueOnce("limit");
    const props = setup(onSave);
    const name = screen.getByLabelText("desktop.snippetName");
    const command = screen.getByLabelText("desktop.snippetCommand");
    fireEvent.change(name, { target: { value: "Deploy" } });
    fireEvent.change(command, { target: { value: "echo ok" } });
    fireEvent.click(screen.getByText("desktop.snippetSave"));
    expect(screen.getByText("desktop.snippetNameTaken")).toBeTruthy();

    fireEvent.change(name, { target: { value: "Deploy 2" } });
    fireEvent.click(screen.getByText("desktop.snippetSave"));
    expect(screen.getByText("desktop.snippetLimit")).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("closes from Escape without saving", () => {
    const props = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
