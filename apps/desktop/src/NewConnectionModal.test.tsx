// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewConnectionModal } from "./NewConnectionModal";
import type { Translator } from "@atlasterm/i18n";

const t = ((key: string) => key) as Translator;

afterEach(() => cleanup());

function setup(
  opts: {
    isNameAvailable?: (n: string) => boolean;
    onCreate?: (c: unknown) => boolean;
  } = {},
) {
  const onClose = vi.fn();
  const onCreate = vi.fn(opts.onCreate ?? (() => true));
  const isNameAvailable = vi.fn(opts.isNameAvailable ?? (() => true));
  const { container } = render(
    <NewConnectionModal
      defaultGroup="Production"
      isNameAvailable={isNameAvailable}
      onClose={onClose}
      onCreate={onCreate as never}
      t={t}
    />,
  );
  return { onClose, onCreate, isNameAvailable, container };
}

describe("NewConnectionModal", () => {
  it("places initial focus on the connection name", () => {
    setup();
    expect(document.activeElement).toBe(
      screen.getByLabelText("desktop.connectionName"),
    );
  });

  it("disables create until name and host are valid", () => {
    const { container } = setup();
    const button = screen.getByRole("button", {
      name: "desktop.createConnection",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: "my-box" } }); // name
    fireEvent.change(inputs[1], { target: { value: "10.0.0.1" } }); // host
    expect(button.disabled).toBe(false);
  });

  it("creates a connection with parsed comma tags and closes", async () => {
    const { container, onCreate, onClose } = setup();
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: "  my-box  " } });
    fireEvent.change(inputs[1], { target: { value: "10.0.0.1" } });
    fireEvent.change(inputs[3], { target: { value: "ssh, gateway , " } }); // tags
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.createConnection" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCreate).toHaveBeenCalledWith({
      name: "my-box",
      host: "10.0.0.1",
      group: "Production",
      tags: ["ssh", "gateway"],
    });
  });

  it("persists an optional username and validated port", async () => {
    const { container, onCreate, onClose } = setup();
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: "jump-box" } });
    fireEvent.change(inputs[1], { target: { value: "jump.internal" } });
    fireEvent.change(screen.getByLabelText("desktop.user"), {
      target: { value: "  ops  " },
    });
    fireEvent.change(screen.getByLabelText("desktop.port"), {
      target: { value: "2222" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.createConnection" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCreate).toHaveBeenCalledWith({
      name: "jump-box",
      host: "jump.internal",
      group: "Production",
      tags: [],
      username: "ops",
      port: 2222,
    });
  });

  it("keeps create disabled for a port outside the SSH range", () => {
    const { container } = setup();
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: "jump-box" } });
    fireEvent.change(inputs[1], { target: { value: "jump.internal" } });
    fireEvent.change(screen.getByLabelText("desktop.port"), {
      target: { value: "65536" },
    });

    expect(
      screen.getByLabelText("desktop.port").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      (
        screen.getByRole("button", {
          name: "desktop.createConnection",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows a name-taken error and keeps create disabled", () => {
    const { container } = setup({ isNameAvailable: () => false });
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: "dup" } });
    fireEvent.change(inputs[1], { target: { value: "h" } });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("desktop.nameTaken");
    expect(alert.className).toContain("inline-alert");
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    expect(alert.querySelector(".inline-alert-icon svg")).toBeTruthy();
    expect(alert.querySelector(".inline-alert-copy strong")?.textContent).toBe(
      "desktop.nameTaken",
    );
    expect(alert.querySelector(".inline-alert-copy small")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "desktop.createConnection",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("does not close when create returns false", async () => {
    const { container, onClose } = setup({ onCreate: () => false });
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: "x" } });
    fireEvent.change(inputs[1], { target: { value: "h" } });
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.createConnection" }),
    );
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and falls back to defaultGroup when group cleared", async () => {
    const { container, onClose, onCreate } = setup();
    const bubbledKeyDown = vi.fn();
    window.addEventListener("keydown", bubbledKeyDown);
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: "g" } });
    fireEvent.change(inputs[1], { target: { value: "h" } });
    fireEvent.change(inputs[2], { target: { value: "" } }); // group cleared
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.createConnection" }),
    );
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ group: "Production" }),
      ),
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(bubbledKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", bubbledKeyDown);
  });

  it("ignores non-Escape keys and a submit while invalid does nothing", () => {
    const { container, onCreate, onClose } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" }); // non-Escape -> no close
    expect(onClose).not.toHaveBeenCalled();

    // Submit the form directly while invalid (button is disabled, so submit the form node).
    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("edit mode prefills fields, locks the name, and saves an update ignoring availability", async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn(() => true);
    const isNameAvailable = vi.fn(() => false); // would block create, but edit ignores it
    const { container } = render(
      <NewConnectionModal
        defaultGroup="Production"
        isNameAvailable={isNameAvailable}
        edit={{
          name: "box",
          host: "old",
          group: "Personal",
          tags: ["ssh", "db"],
          username: "alice",
          port: 2200,
        }}
        onClose={onClose}
        onCreate={onCreate}
        t={t}
      />,
    );
    const inputs = container.querySelectorAll('input[type="text"]');
    const nameInput = inputs[0] as HTMLInputElement;
    expect(nameInput.value).toBe("box");
    expect(nameInput.disabled).toBe(true); // name is the identity key, locked
    expect(document.activeElement).toBe(screen.getByLabelText("desktop.host"));
    expect((inputs[3] as HTMLInputElement).value).toBe("ssh, db"); // tags joined
    expect(
      (screen.getByLabelText("desktop.user") as HTMLInputElement).value,
    ).toBe("alice");
    expect(
      (screen.getByLabelText("desktop.port") as HTMLInputElement).value,
    ).toBe("2200");

    fireEvent.change(inputs[1], { target: { value: "new-host" } }); // host
    fireEvent.click(
      screen.getByRole("button", { name: "desktop.createConnection" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCreate).toHaveBeenCalledWith({
      name: "box",
      host: "new-host",
      group: "Personal",
      tags: ["ssh", "db"],
      username: "alice",
      port: 2200,
    });
  });
});
