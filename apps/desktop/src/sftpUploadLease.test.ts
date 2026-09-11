import { describe, expect, it, vi } from "vitest";
import { uploadWithSessionLease } from "./sftpUploadLease";
describe("SFTP upload lease", () => {
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
