// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupManagerModal } from "./GroupManagerModal";

const t = ((key: string) => key) as any;

function setup(overrides: Partial<React.ComponentProps<typeof GroupManagerModal>> = {}) {
  const props = {
    allGroupNames: ["Production", "My Group"],
    connectionCounts: { Production: 3, "My Group": 1 },
    customGroups: ["My Group"],
    editingGroup: null as string | null,
    editingGroupName: "",
    isGroupValid: vi.fn(() => true),
    newGroupName: "",
    onClose: vi.fn(),
    onCreateGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onSetEditingGroup: vi.fn(),
    onSetEditingGroupName: vi.fn(),
    onSetNewGroupName: vi.fn(),
    onStartEditGroup: vi.fn(),
    t,
    ...overrides,
  };
  render(<GroupManagerModal {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe("GroupManagerModal", () => {
  it("renders builtin and custom groups with counts", () => {
    setup();
    expect(screen.getByText("desktop.groupProduction")).toBeTruthy();
    expect(screen.getByText("My Group")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    // builtin label appears for the non-custom group
    expect(screen.getByText("desktop.groupBuiltin")).toBeTruthy();
  });

  it("typing the new group name calls onSetNewGroupName", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("desktop.newGroupName"), { target: { value: "QA" } });
    expect(props.onSetNewGroupName).toHaveBeenCalledWith("QA");
  });

  it("creates a group via the button when valid", () => {
    const props = setup({ newGroupName: "QA" });
    fireEvent.click(screen.getByText("desktop.createGroup"));
    expect(props.onCreateGroup).toHaveBeenCalledWith("QA");
  });

  it("creates a group via Enter when valid", () => {
    const props = setup({ newGroupName: "QA" });
    fireEvent.keyDown(screen.getByLabelText("desktop.newGroupName"), { key: "Enter" });
    expect(props.onCreateGroup).toHaveBeenCalledWith("QA");
  });

  it("does not create when name is invalid", () => {
    const props = setup({ newGroupName: "dup", isGroupValid: vi.fn(() => false) });
    fireEvent.click(screen.getByText("desktop.createGroup"));
    expect(props.onCreateGroup).not.toHaveBeenCalled();
  });

  it("starts editing a custom group", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText("desktop.renameGroup"));
    expect(props.onStartEditGroup).toHaveBeenCalledWith("My Group", "My Group");
  });

  it("deletes a custom group", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText("desktop.deleteGroup"));
    expect(props.onDeleteGroup).toHaveBeenCalledWith("My Group");
  });

  it("confirms a rename in edit mode", () => {
    const props = setup({ editingGroup: "My Group", editingGroupName: "Renamed" });
    fireEvent.click(screen.getByLabelText("desktop.confirmRename"));
    expect(props.onRenameGroup).toHaveBeenCalledWith("My Group", "Renamed");
    expect(props.onSetEditingGroup).toHaveBeenCalledWith(null);
  });

  it("renames via Enter and cancels via Escape in edit mode", () => {
    const props = setup({ editingGroup: "My Group", editingGroupName: "Renamed" });
    const input = screen.getByLabelText("desktop.renameGroup");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRenameGroup).toHaveBeenCalledWith("My Group", "Renamed");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onSetEditingGroup).toHaveBeenCalledWith(null);
  });

  it("cancels rename via the cancel button", () => {
    const props = setup({ editingGroup: "My Group", editingGroupName: "Renamed" });
    fireEvent.click(screen.getByLabelText("desktop.cancelRename"));
    expect(props.onSetEditingGroup).toHaveBeenCalledWith(null);
  });

  it("does not rename when the edited name is unchanged", () => {
    const props = setup({ editingGroup: "My Group", editingGroupName: "My Group" });
    fireEvent.keyDown(screen.getByLabelText("desktop.renameGroup"), { key: "Enter" });
    expect(props.onRenameGroup).not.toHaveBeenCalled();
    // confirm button still exits edit mode
    fireEvent.click(screen.getByLabelText("desktop.confirmRename"));
    expect(props.onRenameGroup).not.toHaveBeenCalled();
    expect(props.onSetEditingGroup).toHaveBeenCalledWith(null);
  });

  it("does not create a group when the name is empty", () => {
    const props = setup({ newGroupName: "   " });
    fireEvent.keyDown(screen.getByLabelText("desktop.newGroupName"), { key: "Enter" });
    fireEvent.click(screen.getByText("desktop.createGroup"));
    expect(props.onCreateGroup).not.toHaveBeenCalled();
  });

  it("closes via backdrop and Escape", () => {
    const props = setup();
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    fireEvent.keyDown(backdrop, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
