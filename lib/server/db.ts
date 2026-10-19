import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { dataDirectory } from "./config";

const databases = new Map<string, DatabaseSync>();
export function getDatabase() {
  const directory = dataDirectory();
  const cached = databases.get(directory);
  if (cached) return cached;
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const db = new DatabaseSync(path.join(directory, "museum.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('music','albums','videos','photos','journey','timeline','concerts','letters','journal','milestones','memory-book')), title TEXT NOT NULL CHECK(length(title)>0), data TEXT NOT NULL CHECK(json_valid(data)), favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS entries_owner_kind ON entries(owner_id,kind);
    CREATE TABLE IF NOT EXISTS media_assets(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0), media_type TEXT NOT NULL CHECK(media_type IN ('image','audio','video')), storage_path TEXT NOT NULL UNIQUE, metadata TEXT NOT NULL CHECK(json_valid(metadata)), created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS assets_owner ON media_assets(owner_id);
    CREATE TABLE IF NOT EXISTS site_settings(owner_id TEXT PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE, settings TEXT NOT NULL CHECK(json_valid(settings)), updated_at TEXT NOT NULL);
  `);
  databases.set(directory, db);
  return db;
}
export function transaction<T>(run: () => T): T {
  const db = getDatabase(); db.exec("BEGIN IMMEDIATE");
  try {const result = run(); db.exec("COMMIT"); return result;} catch (error) {db.exec("ROLLBACK"); throw error;}
}
