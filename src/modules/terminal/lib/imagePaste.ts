import { invoke } from "@tauri-apps/api/core";

/**
 * Reads an image from the OS clipboard via Rust and returns the path to a
 * temp PNG. Returns `null` when the clipboard has any non-empty text (so the
 * caller falls back to a normal text paste) or when no image is present.
 */
export async function readClipboardImagePath(): Promise<string | null> {
  try {
    const path = await invoke<string | null>("clipboard_read_image");
    return path ?? null;
  } catch (e) {
    console.warn("[terax] clipboard image read failed:", e);
    return null;
  }
}

/** Fire-and-forget cleanup of `terax-clipboard-*.png` older than 24h. */
export async function cleanupTempClipboardImages(): Promise<void> {
  try {
    await invoke("clipboard_cleanup_temp_images");
  } catch (e) {
    console.warn("[terax] clipboard temp cleanup failed:", e);
  }
}
