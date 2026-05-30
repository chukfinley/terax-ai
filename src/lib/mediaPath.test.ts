import { describe, expect, it } from "vitest";
import {
  getMediaKind,
  isMediaPath,
  MEDIA_EXTENSIONS,
} from "./mediaPath";

describe("mediaPath", () => {
  it("exports the expected extension lists", () => {
    expect(MEDIA_EXTENSIONS.image).toContain("png");
    expect(MEDIA_EXTENSIONS.image).toContain("svg");
    expect(MEDIA_EXTENSIONS.video).toContain("avi");
    expect(MEDIA_EXTENSIONS.video).toContain("mkv");
    expect(MEDIA_EXTENSIONS.audio).toContain("m4a");
  });

  it("detects common image extensions", () => {
    expect(getMediaKind("/photos/cat.PNG")).toBe("image");
    expect(getMediaKind("x.gif")).toBe("image");
    expect(getMediaKind("icon.svg")).toBe("image");
  });

  it("detects video and audio extensions", () => {
    expect(getMediaKind("clip.mp4")).toBe("video");
    expect(getMediaKind("clip.webm")).toBe("video");
    expect(getMediaKind("legacy.avi")).toBe("video");
    expect(getMediaKind("song.mp3")).toBe("audio");
  });

  it("returns null for non-media paths", () => {
    expect(getMediaKind("main.rs")).toBeNull();
    expect(isMediaPath("README.md")).toBe(false);
  });
});
