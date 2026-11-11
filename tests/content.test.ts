import { describe, expect, it } from "vitest";
import { parseContent, safeHttpUrl, shouldCollapsePost } from "../src/lib/content";

describe("safe content parsing", () => {
  it("extracts bounded image URLs and keeps text plain", () => {
    const parsed = parseContent("hello <b>world</b> https://cdn.example/photo.JPG?x=1");
    expect(parsed.text).toBe("hello <b>world</b>");
    expect(parsed.images).toEqual(["https://cdn.example/photo.JPG?x=1"]);
    expect(parsed.videos).toEqual([]);
  });

  it("extracts video URLs and NIP-92 Blossom video metadata", () => {
    const parsed = parseContent(
      "Watch https://cdn.example/clip.mp4 and https://blossom.example/hash",
      [["imeta", "url https://blossom.example/hash", "m video/webm"]],
    );
    expect(parsed.text).toBe("Watch  and");
    expect(parsed.videos).toEqual(["https://cdn.example/clip.mp4", "https://blossom.example/hash"]);
    expect(parsed.links).toEqual([]);
  });

  it("uses NIP-92 media types for extensionless Blossom images and videos", () => {
    const parsed = parseContent(
      "Gallery https://blossom.example/image-hash https://blossom.example/video-hash",
      [
        ["imeta", "url https://blossom.example/image-hash", "m image/jpeg"],
        ["imeta", "url https://blossom.example/video-hash", "m video/mp4"],
      ],
    );
    expect(parsed.text).toBe("Gallery");
    expect(parsed.images).toEqual(["https://blossom.example/image-hash"]);
    expect(parsed.videos).toEqual(["https://blossom.example/video-hash"]);
    expect(parsed.links).toEqual([]);
  });

  it("rejects unsafe protocols and credentials", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("https://user:pass@example.com/a.png")).toBeNull();
  });

  it("collapses only posts with substantial length or many lines", () => {
    expect(shouldCollapsePost("A short note that should stay fully visible.")).toBe(false);
    expect(shouldCollapsePost("x".repeat(481))).toBe(true);
    expect(shouldCollapsePost(Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join("\n"))).toBe(true);
  });
});

