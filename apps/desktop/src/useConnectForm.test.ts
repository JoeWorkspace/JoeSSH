// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useConnectForm,
  validateConnectForm,
  type ConnectFormFields,
} from "./useConnectForm";

const VALID: ConnectFormFields = {
  host: "example.com",
  port: "22",
  username: "lin",
  authKind: "password",
  password: "secret",
  pem: "",
  passphrase: "",
  pinnedFingerprint: "",
};

describe("validateConnectForm", () => {
  it("accepts a valid password form and trims fields", () => {
    const result = validateConnectForm({
      ...VALID,
      host: "  h  ",
      username: "  u  ",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        host: "h",
        port: 22,
        username: "u",
        auth: { kind: "password", password: "secret" },
        pinnedFingerprint: undefined,
      },
    });
  });

  it("rejects empty host, bad port, empty username, empty password", () => {
    expect(validateConnectForm({ ...VALID, host: " " })).toMatchObject({
      ok: false,
      reason: "host",
    });
    expect(validateConnectForm({ ...VALID, port: "0" })).toMatchObject({
      ok: false,
      reason: "port",
    });
    expect(validateConnectForm({ ...VALID, port: "70000" })).toMatchObject({
      ok: false,
      reason: "port",
    });
    expect(validateConnectForm({ ...VALID, port: "abc" })).toMatchObject({
      ok: false,
      reason: "port",
    });
    expect(validateConnectForm({ ...VALID, username: "" })).toMatchObject({
      ok: false,
      reason: "username",
    });
    expect(validateConnectForm({ ...VALID, password: "" })).toMatchObject({
      ok: false,
      reason: "password",
    });
  });

  it("validates private-key auth and carries an optional passphrase + pinned fingerprint", () => {
    expect(
      validateConnectForm({ ...VALID, authKind: "private_key", pem: "  " }),
    ).toMatchObject({ ok: false, reason: "pem" });
    const result = validateConnectForm({
      ...VALID,
      authKind: "private_key",
      pem: "KEY",
      passphrase: "pp",
      pinnedFingerprint: " SHA256:abc ",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        host: "example.com",
        port: 22,
        username: "lin",
        auth: { kind: "private_key", pem: "KEY", passphrase: "pp" },
        pinnedFingerprint: "SHA256:abc",
      },
    });
  });

  it("omits an empty passphrase for private-key auth", () => {
    const result = validateConnectForm({
      ...VALID,
      authKind: "private_key",
      pem: "KEY",
      passphrase: "",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        auth: { kind: "private_key", pem: "KEY", passphrase: undefined },
      },
    });
  });
});

describe("useConnectForm", () => {
  it("starts idle and invalid, becomes valid as fields fill in", () => {
    const { result } = renderHook(() => useConnectForm(vi.fn()));
    expect(result.current.status).toEqual({ phase: "idle" });
    expect(result.current.isValid).toBe(false);

    act(() => result.current.setField("host", "h"));
    act(() => result.current.setField("username", "u"));
    act(() => result.current.setField("password", "p"));
    expect(result.current.isValid).toBe(true);
  });

  it("uses initial fields for validation and restores them on reset", async () => {
    const connect = vi.fn().mockResolvedValue("sess-initial");
    const { result } = renderHook(() =>
      useConnectForm(connect, { host: "server.internal", username: "atlas" }),
    );

    expect(result.current.fields.host).toBe("server.internal");
    expect(result.current.fields.username).toBe("atlas");
    expect(result.current.isValid).toBe(false);

    act(() => result.current.setField("password", "secret"));
    expect(result.current.isValid).toBe(true);

    await act(async () => {
      await result.current.submit();
    });
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "server.internal",
        username: "atlas",
        auth: { kind: "password", password: "secret" },
      }),
    );

    act(() => result.current.reset());
    expect(result.current.fields.host).toBe("server.internal");
    expect(result.current.fields.username).toBe("atlas");
    expect(result.current.fields.password).toBe("");
    expect(result.current.status).toEqual({ phase: "idle" });
  });

  it("connects successfully and exposes the session id", async () => {
    const connect = vi.fn().mockResolvedValue("sess-1");
    const { result } = renderHook(() => useConnectForm(connect));
    act(() => result.current.setField("host", "h"));
    act(() => result.current.setField("username", "u"));
    act(() => result.current.setField("password", "p"));

    let returned: string | undefined;
    await act(async () => {
      returned = await result.current.submit();
    });

    expect(returned).toBe("sess-1");
    expect(result.current.status).toEqual({
      phase: "connected",
      sessionId: "sess-1",
    });
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: "h", username: "u", port: 22 }),
    );
  });

  it("coalesces repeated submissions while authentication is pending", async () => {
    let resolveConnect: (sessionId: string) => void = () => {};
    const connect = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const { result } = renderHook(() => useConnectForm(connect, VALID));

    let firstSubmit: Promise<string | undefined> = Promise.resolve(undefined);
    let repeatedSubmit: Promise<string | undefined> =
      Promise.resolve(undefined);
    act(() => {
      firstSubmit = result.current.submit();
      repeatedSubmit = result.current.submit();
    });

    expect(connect).toHaveBeenCalledTimes(1);
    await expect(repeatedSubmit).resolves.toBeUndefined();

    await act(async () => {
      resolveConnect("sess-one");
      await firstSubmit;
    });
    expect(result.current.status).toEqual({
      phase: "connected",
      sessionId: "sess-one",
    });
  });

  it("captures connect errors as an error status", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("auth failed"));
    const { result } = renderHook(() => useConnectForm(connect));
    act(() => result.current.setField("host", "h"));
    act(() => result.current.setField("username", "u"));
    act(() => result.current.setField("password", "p"));

    let returned: string | undefined = "x";
    await act(async () => {
      returned = await result.current.submit();
    });

    expect(returned).toBeUndefined();
    expect(result.current.status).toEqual({
      phase: "error",
      message: "auth failed",
    });
  });

  it("refuses to submit an invalid form and reports the reason", async () => {
    const connect = vi.fn();
    const { result } = renderHook(() => useConnectForm(connect));
    await act(async () => {
      await result.current.submit();
    });
    expect(connect).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ phase: "error", message: "host" });
  });

  it("clears an error status on the next field edit, and reset restores defaults", async () => {
    const { result } = renderHook(() => useConnectForm(vi.fn()));
    await act(async () => {
      await result.current.submit();
    }); // -> error
    expect(result.current.status.phase).toBe("error");

    act(() => result.current.setField("host", "h"));
    expect(result.current.status).toEqual({ phase: "idle" });

    act(() => result.current.setField("username", "u"));
    act(() => result.current.reset());
    expect(result.current.fields.host).toBe("");
    expect(result.current.status).toEqual({ phase: "idle" });
  });
});
