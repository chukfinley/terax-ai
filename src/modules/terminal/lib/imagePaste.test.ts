import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  cleanupTempClipboardImages,
  readClipboardImagePath,
} from "./imagePaste";

describe("imagePaste", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the path when Rust resolves with one", async () => {
    invokeMock.mockResolvedValueOnce("/tmp/terax-clipboard-1.png");
    await expect(readClipboardImagePath()).resolves.toBe(
      "/tmp/terax-clipboard-1.png",
    );
    expect(invokeMock).toHaveBeenCalledWith("clipboard_read_image");
  });

  it("returns null when Rust resolves null (text or no image)", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await expect(readClipboardImagePath()).resolves.toBeNull();
  });

  it("returns null and swallows errors so paste falls back to text", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(readClipboardImagePath()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("cleanup invokes the rust command and swallows errors", async () => {
    invokeMock.mockResolvedValueOnce(7);
    await expect(cleanupTempClipboardImages()).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("clipboard_cleanup_temp_images");

    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(cleanupTempClipboardImages()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
