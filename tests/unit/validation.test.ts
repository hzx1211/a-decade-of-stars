import {describe, expect, it} from "vitest";
import {authSchema, backupAssetSchema, createEntrySchema, entryDataSchema, officialEmbedUrl, patchEntrySchema, rightsSchema, safeUrl} from "../../lib/validation/schemas";

describe("untrusted input boundaries", () => {
  it("requires a real strong owner credential and rejects ownership injection", () => {
    expect(authSchema.safeParse({email: "me@example.com", password: "short"}).success).toBe(false);
    expect(createEntrySchema.safeParse({kind: "journal", title: "我的记录", data: {}, ownerId: "someone-else"}).success).toBe(false);
  });
  it("checks leap days and matching partial-date precision", () => {
    expect(entryDataSchema.safeParse({date: "2024-02-29", datePrecision: "day"}).success).toBe(true);
    expect(entryDataSchema.safeParse({date: "2025-02-29", datePrecision: "day"}).success).toBe(false);
    expect(entryDataSchema.safeParse({date: "2009", datePrecision: "month"}).success).toBe(false);
  });
  it("only accepts safe links and exact official-embed host/path combinations", () => {
    expect(safeUrl.safeParse("javascript:alert(1)").success).toBe(false);
    expect(safeUrl.safeParse("https://user:password@example.com").success).toBe(false);
    expect(officialEmbedUrl("https://www.youtube.com/watch?v=abcdefghijk")).toBe("https://www.youtube-nocookie.com/embed/abcdefghijk");
    expect(officialEmbedUrl("https://www.youtube.com.evil.test/watch?v=abcdefghijk")).toBeNull();
    expect(officialEmbedUrl("http://www.youtube.com/watch?v=abcdefghijk")).toBeNull();
    expect(entryDataSchema.safeParse({sourceType: "official_embed", externalUrl: "https://example.com"}).success).toBe(false);
  });
  it("accepts omitted metadata without inventing authorship, licence or permission claims", () => {
    expect(rightsSchema.parse({})).toEqual({});
    expect(rightsSchema.partial().parse({sourceUrl: "https://example.com/photo"})).toEqual({sourceUrl: "https://example.com/photo"});
    expect(rightsSchema.parse({rightsStatus: "unknown", allowedUseScope: []})).toEqual({rightsStatus: "unknown", allowedUseScope: []});
    expect(rightsSchema.safeParse({rightsStatus: "invented-status"}).success).toBe(false);
    expect(rightsSchema.safeParse({rightsHolder: "x".repeat(501)}).success).toBe(false);
    expect(rightsSchema.safeParse({allowedUseScope: ["invented-scope"]}).success).toBe(false);
    expect(entryDataSchema.safeParse({isPublished: true}).success).toBe(false);
  });
  it("accepts official embeds without a manual scope declaration and preserves patch metadata shape", () => {
    const data = {sourceType: "official_embed", externalUrl: "https://www.bilibili.com/video/BV1234567890"};
    expect(entryDataSchema.parse(data)).toEqual(data);
    expect(patchEntrySchema.parse({title: "新标题"})).toEqual({title: "新标题"});
    expect(patchEntrySchema.parse({data: {description: "我的笔记"}})).toEqual({data: {description: "我的笔记"}});
    expect(entryDataSchema.parse({rightsHolder: "原记录作者", licenseNotes: "原有说明", allowedUseScope: []})).toEqual({rightsHolder: "原记录作者", licenseNotes: "原有说明", allowedUseScope: []});
  });
  it("accepts backup assets with omitted optional metadata, without rewriting historical values", () => {
    const asset = {id: "10000000-0000-4000-8000-000000000001", filename: "synthetic.png", mimeType: "image/png", size: 100, mediaType: "image", storagePath: "owner/synthetic.png", rightsStatus: "personal_only", allowedUseScope: ["private_storage"], createdAt: "2026-10-18T00:00:00.000Z"};
    expect(backupAssetSchema.parse(asset)).toEqual(asset);
    const old = {...asset, rightsHolder: "原记录作者", licenseNotes: "原有说明", rightsStatus: "unknown", allowedUseScope: []};
    expect(backupAssetSchema.parse(old)).toEqual(old);
  });
});
