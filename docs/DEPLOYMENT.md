# 部署

## 本地与私人自托管

执行 README 的 `npm ci`、环境配置、`npm run dev`。正式运行使用 `npm run build` 和 `npm start`；Node 22.13+ 是本地 SQLite 的要求。默认只监听 127.0.0.1。本机首次创建账号后再部署代理，不要通过反向代理开放初始化入口。

本地模式适合具有持久磁盘的单实例 Node 服务。将 `STARS_DATA_DIR` 指向只由应用账户访问的持久目录，备份 SQLite 和媒体。不能部署到只提供临时文件系统的 serverless 实例，也不能将多实例分散到不同 SQLite 文件。需要远程访问时配置 HTTPS 代理和精确 `APP_ORIGIN`；代理传递 Host，关闭对 `.data` 的静态映射。SQLite 只应位于可靠的本地磁盘，不把写入中的数据库放到同步盘。

## Supabase

1. 建立项目，确认当前套餐数据库、Storage 配额、最大文件、流量及费用；HTTPS 应用域名先确定。
2. 在 Auth 关闭允许公开注册，仅由控制台或受控管理 API 创建所有者账号。设置允许的 Site URL 与 redirect URL：`https://你的域名/auth/callback`、`https://你的域名/auth/reset-password`；启用合适 SMTP 后验证恢复邮件。
3. 使用 Supabase CLI migration 或可信 SQL 控制台应用 `supabase/migrations/202610090001_private_memorial.sql`。迁移创建公开 schema 中有 RLS 的三张内容表、profiles、恢复 RPC 和非公开 `private-media` Bucket。此迁移针对新项目，不假定现有同名表可覆盖；已有项目先备份并审查名称冲突。
4. 将 Auth 用户 UUID 插入 `profiles`，仅用 trusted operator 执行：

```sql
insert into public.profiles(id) values ('替换为真实所有者Auth UUID');
```

5. 设置 `DATA_MODE=supabase`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、相同 UUID 的 `SUPABASE_OWNER_ID`、HTTPS `APP_ORIGIN`。不配置 service_role 或 secret key 到运行应用，绝不放进 `NEXT_PUBLIC_`。
6. 重新构建并部署具有 Next.js App Router/Node runtime 的平台。平台请求体上限可能低于媒体大小；当前上传经过应用 API，Vercel 等 serverless 的请求限制不适合默认 100 MB 长视频。需要大文件时选择持久 Node 自托管或另行实现已验证的直传/TUS流程。
7. 若要迁移本地收藏，先分别备份 JSON 与原文件，按云端 owner 路径重新上传媒体并维护 ID/引用；当前没有一键将 SQLite 推送到 Supabase 的迁移命令，不能只切换环境变量后期待原内容出现。

官方参考：<https://supabase.com/docs/guides/auth/server-side/nextjs>、<https://supabase.com/docs/guides/database/postgres/row-level-security>、<https://supabase.com/docs/guides/storage/security/access-control>、<https://supabase.com/docs/guides/storage/uploads/file-limits>。网络未成功读取官方页面时应在部署前重新核对，不把链接本身当作当前版本验证。

## 上线验收

先通过本地构建与测试，再在真实项目逐项验证：所有者登录/退出/重置；匿名及第二 Auth 用户无法查表、RPC或媒体；owner_id 和路径伪造被拒绝；UPDATE 不能夺取其他行；公开 object URL 不可读；所有者图片/音频/视频实际播放及 Range 拖动；恢复事务一处错误整体回滚；媒体删除引用保护；Cookie 在 HTTPS 为 Secure；日志与浏览器包没有密钥；重启后数据仍在。测试完检查产生的文件和测试用户，保留需要的审计记录。

Supabase Auth/Storage 网络与真实套餐尚未配置的情况下，云端能力只能称为已实现接入和迁移，不能称为已上线或生产验证。任何外部发布、公共分享都由所有者明确决定。
