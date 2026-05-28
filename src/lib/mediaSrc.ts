import { mimeForMediaKind, type MediaKind } from "@/lib/mediaPath";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

type FileStat = { size: number };

type ReadMediaResult =
  | { kind: "ok"; data: string; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type MediaUrlResult = {
  src: string;
  size: number;
  revoke?: () => void;
};

function bytesFromBase64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function blobUrl(bytes: Uint8Array, mime: string, size: number): MediaUrlResult {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([buffer], { type: mime });
  const src = URL.createObjectURL(blob);
  return { src, size, revoke: () => URL.revokeObjectURL(src) };
}

/**
 * Load media through workspace-authenticated IPC (works on any drive/path).
 * Falls back to `convertFileSrc` only when the file exceeds the IPC size cap.
 */
export async function resolveMediaUrl(
  path: string,
  kind: MediaKind,
): Promise<MediaUrlResult> {
  const mime = mimeForMediaKind(kind, path);
  const res = await invoke<ReadMediaResult>("fs_read_media", {
    path,
    workspace: currentWorkspaceEnv(),
  });

  if (res.kind === "ok") {
    return blobUrl(bytesFromBase64(res.data), mime, res.size);
  }

  const [canon, stat] = await Promise.all([
    invoke<string>("fs_canonicalize", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
    invoke<FileStat>("fs_stat", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  ]);
  return { src: convertFileSrc(canon), size: stat.size };
}
