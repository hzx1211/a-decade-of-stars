import {describe, expect, it} from "vitest";
import type {Asset, Entry} from "@/lib/types";
import {defaultSettings} from "@/lib/types";
import {publicAssetIds, publicEntries, sanitizePublicAsset, sanitizePublicEntry, sanitizePublicSettings} from "@/lib/public-archive";

const entry = (id: string, isPublic: boolean, data: Entry["data"] = {}): Entry => ({
  id, ownerId: "private-owner-id", kind: "journal", title: id, data, favorite: true, isPublic,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
});

describe("selected public archive projection", () => {
  it("keeps private and draft records out and strips owner-only fields", () => {
    const visible = entry("visible", true, {
      description: "这段文字被明确选为公开精选", notes: "不应对访客显示", assetId: "public-asset",
      relatedIds: ["visible", "private"], itemIds: ["visible", "private"], sourceUrl: "https://private.example/source",
      rightsHolder: "仅所有者可见", rightsStatus: "do_not_publish", status: "saved",
    });
    const privateItem = entry("private", false, {description: "private marker", assetId: "private-asset"});
    const draft = entry("draft", true, {description: "draft marker", status: "draft"});

    expect(publicEntries([visible, privateItem, draft]).map(item => item.id)).toEqual(["visible"]);
    expect(publicAssetIds([visible, privateItem, draft])).toEqual(new Set(["public-asset"]));
    expect(sanitizePublicEntry(visible, new Set(["visible"]))).toEqual(expect.objectContaining({
      ownerId: "", favorite: false, isPublic: true,
      data: expect.objectContaining({description: visible.data.description, relatedIds: ["visible"], itemIds: ["visible"]}),
    }));
    const projected = sanitizePublicEntry(visible, new Set(["visible"]));
    expect(projected.data).not.toHaveProperty("notes");
    expect(projected.data).not.toHaveProperty("sourceUrl");
    expect(projected.data).not.toHaveProperty("rightsHolder");
    expect(projected.data).not.toHaveProperty("rightsStatus");
  });

  it("limits visible asset metadata and filters settings to published IDs", () => {
    const raw: Asset = {
      id: "public-asset", ownerId: "private-owner-id", filename: "selected.png", mimeType: "image/png", size: 25,
      mediaType: "image", storagePath: "private-owner-id/selected.png", sourceUrl: "https://private.example",
      rightsHolder: "private credit", rightsStatus: "personal_only", licenseNotes: "private note",
      allowedUseScope: ["private_storage"], createdAt: "2026-01-01T00:00:00.000Z",
    };
    const safeAsset = sanitizePublicAsset(raw);
    expect(safeAsset).toEqual(expect.objectContaining({ownerId: "", storagePath: "", rightsStatus: "", allowedUseScope: []}));
    expect(safeAsset).not.toHaveProperty("rightsHolder");
    expect(safeAsset).not.toHaveProperty("licenseNotes");
    expect(safeAsset).not.toHaveProperty("sourceUrl");

    const settings = sanitizePublicSettings({...defaultSettings, heroAssetId: "private-asset", featuredIds: ["visible", "private"], hiddenModules: ["photos"], imageLimitMb: 93},
      [entry("visible", true)], [safeAsset]);
    expect(settings.heroAssetId).toBeUndefined();
    expect(settings.featuredIds).toEqual(["visible"]);
    expect(settings.moduleOrder).not.toContain("photos");
    expect(settings.hiddenModules).toEqual([]);
    expect(settings.imageLimitMb).toBe(defaultSettings.imageLimitMb);
  });
});
