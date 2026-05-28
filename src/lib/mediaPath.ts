export const MEDIA_EXTENSIONS = {
  image: [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "bmp",
    "ico",
    "avif",
  ],
  video: ["mp4", "webm", "mov", "mkv", "avi", "ogv", "m4v"],
  audio: ["mp3", "wav", "ogg", "flac", "aac", "m4a"],
} as const;

export type MediaKind = keyof typeof MEDIA_EXTENSIONS;

export type MediaExtension =
  | (typeof MEDIA_EXTENSIONS)["image"][number]
  | (typeof MEDIA_EXTENSIONS)["video"][number]
  | (typeof MEDIA_EXTENSIONS)["audio"][number];

const IMAGE_EXT = new Set<string>(MEDIA_EXTENSIONS.image);
const VIDEO_EXT = new Set<string>(MEDIA_EXTENSIONS.video);
const AUDIO_EXT = new Set<string>(MEDIA_EXTENSIONS.audio);

export function getMediaKind(path: string): MediaKind | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return null;
}

export function isMediaPath(path: string): boolean {
  return getMediaKind(path) !== null;
}

export function mimeForMediaKind(kind: MediaKind, path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (kind) {
    case "image":
      if (ext === "svg") return "image/svg+xml";
      if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
      if (ext === "gif") return "image/gif";
      if (ext === "webp") return "image/webp";
      if (ext === "avif") return "image/avif";
      if (ext === "bmp") return "image/bmp";
      if (ext === "ico") return "image/x-icon";
      return "image/png";
    case "video":
      if (ext === "webm") return "video/webm";
      if (ext === "ogv") return "video/ogg";
      if (ext === "mov") return "video/quicktime";
      if (ext === "avi") return "video/x-msvideo";
      if (ext === "mkv") return "video/x-matroska";
      return "video/mp4";
    case "audio":
      if (ext === "wav") return "audio/wav";
      if (ext === "ogg") return "audio/ogg";
      if (ext === "flac") return "audio/flac";
      if (ext === "m4a") return "audio/mp4";
      if (ext === "aac") return "audio/aac";
      return "audio/mpeg";
  }
}
