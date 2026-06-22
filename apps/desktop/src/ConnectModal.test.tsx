// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectModal } from "./ConnectModal";
import type { Translator } from "@atlasterm/i18n";
import type { ConnectSubmitInput } from "./useConnectForm";

const t = ((key: string) => key) as Translator;

afterEach(() => cleanup());

function setup(
  onConnect: (input: ConnectSubmitInput) => Promise<string>,
  props: Partial<Pick<ComponentProps<typeof ConnectModal>, "defaultHost" | "defaultPort" | "defaultUsername" | "onHostKeyProbe">> = {},
) {
  const onClose = vi.fn();
  const onConnected = vi.fn();
  const { container } = render(
    <ConnectModal onClose={onClose} onConnect={onConnect} onConnected={onConnected} t={t} {...props} />,
  );
  return { onClose, onConnected, container };
}

const q = (container: HTMLElement, selector: string) => container.querySelector(selector) as HTMLInputElement;

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type HostKeyProbeResultForTest = Awaited<ReturnType<NonNullable<ComponentProps<typeof ConnectModal>["onHostKeyProbe"]>>>;

describe("ConnectModal", () => {
  it("renders a labelled dialog with a disabled connect button until valid", () => {
    setup(vi.fn());
    expect(screen.getByRole("dialog", { name: "desktop.connectTitle" })).toBeTruthy();
    const button = screen.getByRole("button", { name: "desktop.connectAction" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("submits a password connection and reports the session id", async () => {
    const onConnect = vi.fn().mockResolvedValue("sess-9");
    const { onClose, onConnected, container } = setup(onConnect);

    fireEvent.change(q(container, 'input[type="text"]'), { target: { value: "example.com" } });
    fireEvent.change(q(container, 'input[type="number"]'), { target: { value: "22" } });
    // second text input is username
    fireEvent.change(container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement, {
      target: { value: "lin" },
    });
    fireEvent.change(q(container, 'input[type="password"]'), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "desktop.connectAction" }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("sess-9"));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
      host: "example.com", username: "lin", port: 22, auth: { kind: "password", password: "secret" },
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it("uses default host and username values for validation and submit", async () => {
    const onConnect = vi.fn().mockResolvedValue("sess-default");
    const { onConnected, container } = setup(onConnect, {
      defaultHost: "server.internal",
      defaultUsername: "atlas",
    });
    const button = screen.getByRole("button", { name: "desktop.connectAction" }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(q(container, 'input[type="text"]').value).toBe("server.internal");
    expect((container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement).value).toBe("atlas");

    fireEvent.change(q(container, 'input[type="password"]'), { target: { value: "secret" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("sess-default"));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
      host: "server.internal",
      username: "atlas",
      port: 22,
      auth: { kind: "password", password: "secret" },
    }));
  });

  it("requires confirmation for an unknown host key before authenticating", async () => {
    const onConnect = vi.fn().mockResolvedValue("sess-host-key");
    const onHostKeyProbe = vi.fn().mockResolvedValue({
      status: "unknown",
      presented_fingerprint: "SHA256:new-host",
      stored_fingerprint: null,
    });
    const { onConnected, container } = setup(onConnect, { onHostKeyProbe });

    fireEvent.change(q(container, 'input[type="text"]'), { target: { value: "example.com" } });
    fireEvent.change(container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement, {
      target: { value: "lin" },
    });
    fireEvent.change(q(container, 'input[type="password"]'), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "desktop.connectAction" }));

    await waitFor(() => expect(onHostKeyProbe).toHaveBeenCalledWith("example.com", 22));
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByText("desktop.hostKeyConfirmTitle")).toBeTruthy();
    expect(screen.getByText("SHA256:new-host")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "desktop.trustHostKeyAndConnect" }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("sess-host-key"));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
      host: "example.com",
      username: "lin",
      pinnedFingerprint: "SHA256:new-host",
    }));
  });

  it("blocks authentication when the stored host key changed", async () => {
    const onConnect = vi.fn().mockResolvedValue("sess-host-key");
    const onHostKeyProbe = vi.fn().mockResolvedValue({
      status: "changed",
      presented_fingerprint: "SHA256:presented",
      stored_fingerprint: "SHA256:stored",
    });
    const { container } = setup(onConnect, { onHostKeyProbe });

    fireEvent.change(q(container, 'input[type="text"]'), { target: { value: "example.com" } });
    fireEvent.change(container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement, {
      target: { value: "lin" },
    });
    fireEvent.change(q(container, 'input[type="password"]'), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "desktop.connectAction" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("desktop.hostKeyChangedDetail"));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("ignores stale host-key probe results after the host changes", async () => {
    const staleProbe = deferred<HostKeyProbeResultForTest>();
    const onConnect = vi.fn().mockResolvedValue("sess-host-key");
    const onHostKeyProbe = vi.fn().mockReturnValue(staleProbe.promise);
    const { container } = setup(onConnect, { onHostKeyProbe });

    fireEvent.change(q(container, 'input[type="text"]'), { target: { value: "old.example.com" } });
    fireEvent.change(container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement, {
      target: { value: "lin" },
    });
    fireEvent.change(q(container, 'input[type="password"]'), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "desktop.connectAction" }));
    await waitFor(() => expect(onHostKeyProbe).toHaveBeenCalledWith("old.example.com", 22));

    fireEvent.change(q(container, 'input[type="text"]'), { target: { value: "new.example.com" } });
    staleProbe.resolve({
      status: "changed",
      presented_fingerprint: "SHA256:stale-presented",
      stored_fingerprint: "SHA256:stale-stored",
    });

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("desktop.hostKeyConfirmTitle")).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("continues directly when the stored host key matches", async () => {
    const onConnect = vi.fn().mockResolvedValue("sess-match");
    const onHostKeyProbe = vi.fn().mockResolvedValue({
      status: "match",
      presented_fingerprint: "SHA256:stored",
      stored_fingerprint: "SHA256:stored",
    });
    const { onConnected, container } = setup(onConnect, { onHostKeyProbe });

    fireEvent.change(q(container, 'input[type="text"]'), { target: { value: "example.com" } });
    fireEvent.change(container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement, {
      target: { value: "lin" },
    });
    fireEvent.change(q(container, 'input[type="password"]'), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "desktop.connectAction" }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("sess-match"));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
      host: "example.com",
      username: "lin",
      pinnedFingerprint: undefined,
    }));
  });

  it("uses a default port when provided by Quick Connect parsing", async () => {
    const onConnect = vi.fn().mockResolvedValue("sess-port");
    const { onConnected, container } = setup(onConnect, {
      defaultHost: "server.internal",
      defaultPort: 2200,
      defaultUsername: "atlas",
    });
    const button = screen.getByRole("button", { name: "desktop.connectAction" }) as HTMLButtonElement;

    expect(q(container, 'input[type="number"]').value).toBe("2200");
    fireEvent.change(q(container, 'input[type="password"]'), { target: { value: "secret" } });
    fireEvent.click(button);

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("sess-port"));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
      host: "server.internal",
      username: "atlas",
      port: 2200,
    }));
  });

  it("switches to private-key fields and submits a key payload", async () => {
    const onConnect = vi.fn().mockResolvedValue("sess-k");
    const { onConnected, container } = setup(onConnect);

    fireEvent.change(q(container, 'input[type="text"]'), { target: { value: "h" } });
    fireEvent.change(container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement, {
      target: { value: "u" },
    });
    fireEvent.change(q(container, 'input[type="number"]'), { target: { value: "2222" } });
    fireEvent.change(q(container, "select"), { target: { value: "private_key" } });
    fireEvent.change(q(container, "textarea"), { target: { value: "KEYDATA" } });
    fireEvent.change(q(container, 'input[type="password"]'), { target: { value: "pp" } });
    // pinnedFingerprint is the last text input (host, username, then fingerprint)
    const textInputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(textInputs[textInputs.length - 1] as HTMLInputElement, { target: { value: "SHA256:zz" } });
    fireEvent.click(screen.getByRole("button", { name: "desktop.connectAction" }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("sess-k"));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
      port: 2222,
      auth: { kind: "private_key", pem: "KEYDATA", passphrase: "pp" },
      pinnedFingerprint: "SHA256:zz",
    }));
  });

  it("shows an error and does not close when the connection fails", async () => {
    const onConnect = vi.fn().mockRejectedValue(new Error("auth failed"));
    const { onClose, onConnected, container } = setup(onConnect);

    fireEvent.change(q(container, 'input[type="text"]'), { target: { value: "h" } });
    fireEvent.change(container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement, {
      target: { value: "u" },
    });
    fireEvent.change(q(container, 'input[type="password"]'), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: "desktop.connectAction" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("auth failed"));
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("inline-alert");
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    expect(alert.querySelector(".inline-alert-icon svg")).toBeTruthy();
    expect(alert.querySelector(".inline-alert-copy strong")?.textContent).toBe("desktop.connectFailed");
    expect(alert.querySelector(".inline-alert-copy small")?.textContent).toBe("auth failed");
    expect(onConnected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and on backdrop click", () => {
    const onClose = vi.fn();
    render(<ConnectModal onClose={onClose} onConnect={vi.fn()} onConnected={vi.fn()} t={t} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
