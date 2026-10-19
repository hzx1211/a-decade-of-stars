import {describe, expect, it} from "vitest";
import {getActiveLyricIndex, parseLyrics} from "../../lib/lyrics";
import {defaultSettings} from "../../lib/types";
import {backupSchema, createEntrySchema, entryDataSchema, patchEntrySchema} from "../../lib/validation/schemas";

describe("local lyric parsing", () => {
  it("reads BOM, CRLF, metadata and decimal LRC timestamps without turning metadata into lyrics", () => {
    expect(parseLyrics("\uFEFF[ti:自制验收文本]\r\n[ar:测试]\r\n[00:01.2]第一句\r\n[01:02.345]第二句\r\n[01:03:45]第三句")).toEqual({
      synced: true,
      lines: [{time: 1.2, text: "第一句"}, {time: 62.345, text: "第二句"}, {time: 63.45, text: "第三句"}],
    });
  });

  it("sorts repeated time tags and merges translations at the same timestamp without duplicate text", () => {
    expect(parseLyrics("[00:08][00:02]原文\n[00:02]Translation\n[00:02]原文\n[00:05]\n[00:08][00:08]原文")).toEqual({
      synced: true,
      lines: [{time: 2, text: "原文\nTranslation"}, {time: 5, text: ""}, {time: 8, text: "原文"}],
    });
  });

  it("uses the last valid global millisecond offset even when it occurs after the cues", () => {
    const earlier = parseLyrics("[offset:-200]\n[00:01]第一句\n[00:02]第二句\n[offset:+500]\n[offset:not-a-number]\n[offset:999999999999999999999]");
    expect(earlier.lines).toEqual([{time: 0.5, text: "第一句"}, {time: 1.5, text: "第二句"}]);
    expect(parseLyrics("[offset:-250]\n[00:01]第一句").lines[0].time).toBe(1.25);
    expect(parseLyrics("[offset:500]\n[00:00]第一句").lines[0].time).toBe(-0.5);
    expect(getActiveLyricIndex(parseLyrics("[offset:500]\n[00:00]第一句").lines, 0)).toBe(0);
  });

  it("keeps TXT and HTML-looking content as literal text, with no fake synchronized timing", () => {
    const parsed = parseLyrics("[ti:自制验收文本]\n第一句\n\n<script>alert('literal')</script>\n[Chorus]下一句\n[未关闭");
    expect(parsed).toEqual({synced: false, lines: [
      {time: null, text: "第一句"}, {time: null, text: "<script>alert('literal')</script>"},
      {time: null, text: "[Chorus]下一句"}, {time: null, text: "[未关闭"},
    ]});
    expect(getActiveLyricIndex(parsed.lines, 10)).toBe(-1);
  });

  it("does not manufacture valid cues out of malformed timestamps", () => {
    const invalid = "[00:60]秒数无效\n[1:2]秒数缺位\n[-01:02]负数\n[NaN:01]无效数字\n[00:01.2x]小数无效";
    expect(parseLyrics(invalid).synced).toBe(false);
    const parsed = parseLyrics(`${invalid}\n[00:03.125]有效\n标题`);
    expect(parsed).toEqual({synced: true, lines: [{time: 3.125, text: "有效"}]});
    expect(parseLyrics("\n[ar:测试]\n[offset:0]\n")).toEqual({synced: false, lines: []});
  });

  it("bounds oversized source and repeated timestamp expansion", () => {
    const oversized = parseLyrics("a".repeat(100_001));
    expect(oversized.lines[0].text).toHaveLength(100_000);
    const timestamps = Array.from({length: 10_001}, (_, index) => `[${String(Math.floor(index / 60)).padStart(3, "0")}:${String(index % 60).padStart(2, "0")}]`).join("");
    expect(parseLyrics(`${timestamps}x`).lines).toHaveLength(10_000);
    const repeated = parseLyrics(`${timestamps.slice(0, 32_000)}${"x".repeat(50_000)}`);
    expect(repeated.synced).toBe(true);
    expect(repeated.lines.reduce((total, line) => total + line.text.length, 0)).toBeLessThanOrEqual(1_000_000);
  });
});

describe("lyric playback clock", () => {
  const {lines} = parseLyrics("[00:02]一\n[00:05.5]二\n[00:09]三");

  it("follows exact cue boundaries, seeks backward and retains the last cue after the song ends", () => {
    expect(getActiveLyricIndex(lines, 1.999)).toBe(-1);
    expect(getActiveLyricIndex(lines, 2)).toBe(0);
    expect(getActiveLyricIndex(lines, 5.5)).toBe(1);
    expect(getActiveLyricIndex(lines, 20)).toBe(2);
    expect(getActiveLyricIndex(lines, 3)).toBe(0);
    expect(getActiveLyricIndex([], 3)).toBe(-1);
    expect(getActiveLyricIndex(lines, Number.NaN)).toBe(-1);
    expect(getActiveLyricIndex(lines, Number.POSITIVE_INFINITY)).toBe(-1);
  });

  it("advances lyrics for positive manual offsets and delays them for negative offsets", () => {
    expect(getActiveLyricIndex(lines, 1.5, 500)).toBe(0);
    expect(getActiveLyricIndex(lines, 2, -500)).toBe(-1);
    expect(getActiveLyricIndex(lines, 2.5, -500)).toBe(0);
    expect(getActiveLyricIndex(lines, 2, Number.NaN)).toBe(0);
    const embedded = parseLyrics("[offset:500]\n[00:02]一");
    expect(getActiveLyricIndex(embedded.lines, 1, 500)).toBe(0);
  });
});

describe("private lyric storage validation", () => {
  const data = {artist: "测试", notes: "保留原记录", lyrics: "[00:01.2]自己编写的验收文本", lyricsOffset: -250};

  it("round trips optional lyrics through existing create, patch and backup shapes", () => {
    expect(entryDataSchema.parse({})).toEqual({});
    expect(createEntrySchema.parse({kind: "music", title: "验收曲目", data}).data).toEqual(data);
    expect(patchEntrySchema.parse({data}).data).toEqual(data);
    const exported = {version: 1, entries: [{
      id: "00000000-0000-4000-8000-000000000001", ownerId: "private-owner", kind: "music", title: "验收曲目", data,
      favorite: false, createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z",
    }], settings: {...defaultSettings}, assets: [], mediaFilesIncluded: false};
    expect(backupSchema.parse(JSON.parse(JSON.stringify(exported))).entries[0].data).toEqual(data);
    expect(backupSchema.parse({...exported, entries: [{...exported.entries[0], data: {notes: "旧版记录"}}]}).entries[0].data).toEqual({notes: "旧版记录"});
  });

  it("accepts the lyric and offset limits and rejects oversized, noninteger or nonfinite values", () => {
    expect(entryDataSchema.safeParse({lyrics: "a".repeat(100_000), lyricsOffset: 600_000}).success).toBe(true);
    expect(entryDataSchema.safeParse({lyrics: "", lyricsOffset: -600_000}).success).toBe(true);
    expect(entryDataSchema.safeParse({lyrics: "a".repeat(100_001)}).success).toBe(false);
    for (const lyricsOffset of [-600_001, 600_001, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "500", null]) {
      expect(entryDataSchema.safeParse({lyricsOffset}).success).toBe(false);
    }
    expect(entryDataSchema.safeParse({lyrics: 123}).success).toBe(false);
  });
});
