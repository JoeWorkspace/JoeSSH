import { describe, expect, it, vi } from "vitest";
import { uploadWithSessionLease } from "./sftpUploadLease";
describe("SFTP upload lease", () => {
  it("does not read a local file when the captured connection has already expired", async () => {
    const file = { arrayBuffer: vi.fn() };
    const upload = vi.fn();
    expect(
      await uploadWithSessionLease(file, "/original/file", {
        isCurrent: () => false,
        upload,
      }),
    ).toBe("expired");
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "reports the captured upload result (%s) without retrying",
    async (uploaded) => {
      const upload = vi.fn(async () => uploaded);
      expect(
        await uploadWithSessionLease(
          { arrayBuffer: async () => new Uint8Array([0, 255]).buffer },
          "/original/file",
          { isCurrent: () => true, upload },
        ),
      ).toBe(uploaded ? "uploaded" : "failed");
      expect(upload).toHaveBeenCalledExactlyOnceWith(
        "/original/file",
        [0, 255],
      );
    },
  );

  it.each(["read", "write"])(
    "reports %s failures without dispatching a retry",
    async (stage) => {
      const upload = vi.fn(async () => {
        throw new Error("connection lost");
      });
      const file = {
        arrayBuffer: vi.fn(async () => {
          if (stage === "read") throw new Error("local file unavailable");
          return new Uint8Array([65]).buffer;
        }),
      };
      expect(
        await uploadWithSessionLease(file, "/original/file", {
          isCurrent: () => true,
          upload,
        }),
      ).toBe("failed");
      expect(file.arrayBuffer).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledTimes(stage === "read" ? 0 : 1);
    },
  );

  it("does not dispatch after a disconnect/reconnect during file reading", async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    const file = {
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    };
    let session = "old";
    const upload = vi.fn();
    const pending = uploadWithSessionLease(file, "/srv/file", {
      isCurrent: () => session === "old",
      upload,
    });
    session = "new";
    finish(new Uint8Array([65]).buffer);
    expect(await pending).toBe("expired");
    expect(upload).not.toHaveBeenCalled();
  });
  it("uses the captured target once and reports an interrupted remote write as failed", async () => {
    let valid = true;
    const upload = vi.fn(async () => {
      valid = false;
      return true;
    });
    const result = await uploadWithSessionLease(
      { arrayBuffer: async () => new Uint8Array([65]).buffer },
      "/srv/file",
      { isCurrent: () => valid, upload },
    );
    expect(result).toBe("failed");
    expect(upload).toHaveBeenCalledExactlyOnceWith("/srv/file", [65]);
  });
});
