import {describe, expect, it} from "vitest";
import {parseNeteaseMusic} from "../../lib/netease";
import {entryDataSchema, officialEmbedUrl, safeUrl} from "../../lib/validation/schemas";

const song = {
  id: "28059417",
  url: "https://music.163.com/song?id=28059417",
  embedUrl: "https://music.163.com/outchain/player?type=2&id=28059417&auto=0&height=66",
};

describe("parseNeteaseMusic", () => {
  it("normalizes supported single-song URL forms", () => {
    const inputs = [
      "https://music.163.com/song?id=28059417",
      "https://music.163.com/#/outchain/2/28059417/",
      "https://music.163.com/#/song?id=28059417",
      "https://music.163.com/outchain/player?type=2&id=28059417&auto=1&height=66",
      "//music.163.com/outchain/player?type=2&id=28059417&auto=1&height=66",
      '<iframe frameborder="no" border="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=28059417&auto=1&height=66"></iframe>',
    ];

    for (const input of inputs) expect(parseNeteaseMusic(input)).toEqual(song);
  });

  it("rejects unsafe origins, ports, schemes, malformed IDs, and non-song player types", () => {
    const invalid = [
      "http://music.163.com/song?id=28059417",
      "//music.163.com/song?id=28059417",
      "https://music.163.com:444/song?id=28059417",
      "https://user@music.163.com/song?id=28059417",
      "https://music.163.com.evil.test/song?id=28059417",
      "https://music.163.com./song?id=28059417",
      "https://music.163.com/outchain/player?type=0&id=28059417",
      "https://music.163.com/outchain/player?type=1&id=28059417",
      "https://music.163.com/outchain/player?type=2&type=1&id=28059417",
      "https://music.163.com/outchain/player?type=2&id=0",
      "https://music.163.com/song?id=28abc",
      "https://music.163.com/song?id=28059417&id=5",
      "https://music.163.com/#/playlist?id=28059417",
      "javascript:alert(1)",
    ];

    for (const input of invalid) expect(parseNeteaseMusic(input), input).toBeNull();
  });

  it("extracts only src from a complete iframe and rejects arbitrary or ambiguous HTML", () => {
    expect(parseNeteaseMusic(`<div><iframe src="${song.embedUrl}"></iframe></div>`)).toBeNull();
    expect(parseNeteaseMusic(`<iframe src="${song.embedUrl}"></iframe><script>alert(1)</script>`)).toBeNull();
    expect(parseNeteaseMusic(`<iframe src="${song.embedUrl}" src="${song.embedUrl}"></iframe>`)).toBeNull();
    expect(parseNeteaseMusic(`<iframe src="https://evil.test/outchain/player?type=2&id=28059417"></iframe>`)).toBeNull();
  });

  it("provides a safe embed URL without enabling automatic playback", () => {
    expect(officialEmbedUrl("https://music.163.com/song?id=28059417")).toBe(song.embedUrl);
    expect(officialEmbedUrl(`<iframe src="${song.embedUrl}"></iframe>`)).toBe(song.embedUrl);
    expect(officialEmbedUrl("https://www.youtube.com/watch?v=abcdefghijk")).toBe("https://www.youtube-nocookie.com/embed/abcdefghijk");
    expect(officialEmbedUrl("https://www.bilibili.com/video/BV1xx411c7mD")).toBe("https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0");
  });

  it("persists only the canonical NetEase song URL, never iframe text or the player URL", () => {
    const base = {sourceType: "official_embed", allowedUseScope: ["official_embed"]};
    expect(safeUrl.safeParse(song.url).success).toBe(true);
    expect(safeUrl.safeParse(`<iframe src="${song.embedUrl}"></iframe>`).success).toBe(false);
    expect(entryDataSchema.safeParse({...base, externalUrl: song.url}).success).toBe(true);
    expect(entryDataSchema.safeParse({...base, externalUrl: song.embedUrl}).success).toBe(false);
    expect(entryDataSchema.safeParse({...base, externalUrl: "https://music.163.com/#/outchain/2/28059417/"}).success).toBe(false);
    expect(entryDataSchema.safeParse({...base, externalUrl: `<iframe src="${song.embedUrl}"></iframe>`}).success).toBe(false);
  });
});
