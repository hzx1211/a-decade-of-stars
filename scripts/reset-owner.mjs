import { DatabaseSync } from "node:sqlite";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import fs from "node:fs";
import path from "node:path";

if ((process.env.DATA_MODE || "local") !== "local") throw new Error("Supabase 账号请使用恢复邮件或 Supabase 控制台，不运行本地重置。");
const directory = path.resolve(process.env.STARS_DATA_DIR || path.join(process.cwd(), ".data"));
const databasePath = path.join(directory, "museum.sqlite");
if (!fs.existsSync(databasePath)) throw new Error("尚未建立本地数据库，请先运行网站并创建所有者账号。");
const db = new DatabaseSync(databasePath); db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
const owner = db.prepare("SELECT id,email FROM owners LIMIT 1").get();
if (!owner) throw new Error("尚未创建所有者账号，请打开本机网站完成首次设置。");
const silentOutput = new Writable({write(_chunk, _encoding, callback) {callback();}});
const reader = createInterface({input: process.stdin, output: silentOutput, terminal: process.stdin.isTTY});
process.stdout.write(`本机重置 ${owner.email} 的密码。记录和媒体保留，全部旧会话将失效。\n`);
process.stdout.write("新密码（至少 12 个字符，输入不显示）：");
const password = await reader.question(""); process.stdout.write("\n再次输入：");
const confirmation = await reader.question(""); reader.close(); process.stdout.write("\n");
if (password.length < 12 || password.length > 256 || password !== confirmation) throw new Error("密码长度不合要求，或两次输入不一致。未修改账号。");
const salt = randomBytes(32).toString("hex"); const key = await promisify(scrypt)(password, salt, 64);
const backupDirectory = path.join(directory, "backups"); fs.mkdirSync(backupDirectory, {recursive: true, mode: 0o700});
const backupPath = path.join(backupDirectory, `before-password-reset-${Date.now()}.sqlite`);
db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}';`);
db.exec("BEGIN IMMEDIATE");
try {db.prepare("UPDATE owners SET password_hash=? WHERE id=?").run(`scrypt$${salt}$${key.toString("hex")}`, owner.id); db.prepare("DELETE FROM sessions WHERE owner_id=?").run(owner.id); db.exec("COMMIT");} catch (error) {db.exec("ROLLBACK"); throw error;} finally {db.close();}
console.log("密码已更新，全部旧会话已退出。重置前的数据库快照保存在私人 .data/backups/ 目录。");
