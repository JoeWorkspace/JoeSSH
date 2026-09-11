/** Captured at picker launch. Never substitute the currently visible connection. */
export async function uploadWithSessionLease(
  file: Pick<File, "arrayBuffer">,
  remotePath: string,
  lease: {
    isCurrent: () => boolean;
    upload: (path: string, bytes: number[]) => Promise<boolean>;
  },
): Promise<"uploaded" | "expired" | "failed"> {
  if (!lease.isCurrent()) return "expired";
  try {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    if (!lease.isCurrent()) return "expired";
    const uploaded = await lease.upload(remotePath, bytes);
    // A lost connection can leave a partial remote file. Do not retry or report success.
    return uploaded && lease.isCurrent() ? "uploaded" : "failed";
  } catch {
    return "failed";
  }
}
