import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SftpReadFn = (path: string) => Promise<number[]>;
export type SftpWriteFn = (path: string, data: number[]) => Promise<void>;
export const SFTP_TRANSFER_MAX_BYTES = 25 * 1024 * 1024;

export type TransferStatus =
  | { phase: "idle" }
  | { phase: "transferring" }
  | { phase: "error"; message: string };

export type SftpTransferOptions = {
  limitMessage?: (maxBytes: number) => string;
  maxBytes?: number;
};

export type SftpDownloadOptions = {
  knownSizeBytes?: number | null;
};

/// File transfer over SFTP. `read`/`write` are injected (the desktop runtime
/// wires real `sftp_read`/`sftp_write`); when absent the hook is inactive so
/// the panel can keep its static fallback. `download` returns the file bytes
/// (the caller turns them into a browser download); `upload` sends bytes.
export function useSftpTransfer(
  read?: SftpReadFn,
  write?: SftpWriteFn,
  options: SftpTransferOptions = {},
) {
  const [status, setStatus] = useState<TransferStatus>({ phase: "idle" });
  const operationSeq = useRef(0);
  const active = read !== undefined && write !== undefined;
  const maxBytes = options.maxBytes ?? SFTP_TRANSFER_MAX_BYTES;
  const limitMessage = useMemo(
    () =>
      options.limitMessage ??
      ((limit: number) => `Transfer exceeds the ${limit} byte safety limit.`),
    [options.limitMessage],
  );

  const rejectTooLarge = useCallback(() => {
    setStatus({ phase: "error", message: limitMessage(maxBytes) });
  }, [limitMessage, maxBytes]);

  useEffect(() => {
    operationSeq.current += 1;
    setStatus({ phase: "idle" });
  }, [read, write]);

  const download = useCallback(
    async (
      path: string,
      downloadOptions: SftpDownloadOptions = {},
    ): Promise<number[] | undefined> => {
      if (!read) return undefined;
      if (
        downloadOptions.knownSizeBytes !== null &&
        downloadOptions.knownSizeBytes !== undefined &&
        downloadOptions.knownSizeBytes > maxBytes
      ) {
        rejectTooLarge();
        return undefined;
      }
      const requestSeq = operationSeq.current + 1;
      operationSeq.current = requestSeq;
      setStatus({ phase: "transferring" });
      try {
        const bytes = await read(path);
        if (operationSeq.current !== requestSeq) return undefined;
        if (bytes.length > maxBytes) {
          rejectTooLarge();
          return undefined;
        }
        setStatus({ phase: "idle" });
        return bytes;
      } catch (error) {
        if (operationSeq.current !== requestSeq) return undefined;
        setStatus({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    },
    [maxBytes, read, rejectTooLarge],
  );

  const upload = useCallback(
    async (path: string, data: number[]): Promise<boolean> => {
      if (!write) return false;
      if (data.length > maxBytes) {
        rejectTooLarge();
        return false;
      }
      const requestSeq = operationSeq.current + 1;
      operationSeq.current = requestSeq;
      setStatus({ phase: "transferring" });
      try {
        await write(path, data);
        if (operationSeq.current !== requestSeq) return false;
        setStatus({ phase: "idle" });
        return true;
      } catch (error) {
        if (operationSeq.current !== requestSeq) return false;
        setStatus({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    [maxBytes, rejectTooLarge, write],
  );

  return { status, active, download, rejectTooLarge, upload };
}
