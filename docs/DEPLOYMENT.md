# 部署

## 本地与私人自托管

执行 README 的 `npm ci`、环境配置、`npm run dev`。正式运行使用 `npm run build` 和 `npm start`。项目要求 Node.js 22.13+；Vercel 云项目可选择 Node.js 24。默认只监听 127.0.0.1。本机首次创建账号后再部署代理，不要通过反向代理开放初始化入口。

本地模式适合具有持久磁盘的单实例 Node 服务。将 `STARS_DATA_DIR` 指向只由应用账户访问的持久目录，备份 SQLite 和媒体。不能部署到只提供临时文件系统的 serverless 实例，也不能将多实例分散到不同 SQLite 文件。需要远程访问时配置 HTTPS 代理和精确 `APP_ORIGIN`；代理传递 Host，关闭对 `.data` 的静态映射。SQLite 只应位于可靠的本地磁盘，不把写入中的数据库放到同步盘。

## Vercel 与 Supabase

Vercel 部署必须设置 `DATA_MODE=supabase`。若 Vercel 运行时仍使用本地模式，云端数据请求会 fail closed 并返回配置错误。

在 Vercel 项目环境变量中配置：

- `DATA_MODE=supabase`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_OWNER_ID`：受控创建的唯一所有者 Auth UUID
- `APP_ORIGIN`：应用的规范 HTTPS 源，例如 `https://你的域名`
- `CLOUD_UPLOAD_LIMIT_MB=50`：云端上限必须大于 0 且不超过 50 MB；类型和站点设置还能进一步降低上限

运行中的应用不需要 `service_role` 或其他 Supabase secret key；不要添加到 Vercel 环境变量，也不要放进客户端变量。项目要求 Node.js 22.13+，Vercel 云项目可选择 Node.js 24，并使用 Next.js Node runtime。

1. 建立 Supabase 项目，确认套餐数据库、Storage 配额、文件上限、流量及费用。先确定 HTTPS 应用域名并设置 Site URL 与 redirect URL：`https://你的域名/auth/callback`、`https://你的域名/auth/reset-password`。如需密码恢复邮件，配置 SMTP 并验证流程。
2. 通过 Supabase CLI 或可信 SQL 控制台按时间顺序应用迁移。先应用第一份；随后通过受控管理流程创建唯一 Auth 所有者；再继续依序应用剩余迁移。所有迁移完成前不要接入线上流量：

   1. `supabase/migrations/202610090001_private_memorial.sql`
   2. `supabase/migrations/202610180001_optional_media_metadata.sql`
   3. `supabase/migrations/202610200001_selected_public_readonly.sql`
   4. `supabase/migrations/20261023110248_private_cloud_release.sql`
   5. `supabase/migrations/20261023111432_single_owner_auth_registration.sql`
   6. `supabase/migrations/20261023112230_defer_owner_registration_validation.sql`

   最后两份迁移在数据库层限制新 Auth 用户注册，并在事务提交时检查所有者注册状态。受控创建的唯一所有者之外，不应允许其他 Auth 用户。历史 `isPublic` 标记不会开放匿名读取；所有内容和媒体都要求所有者认证。若项目已有表或 Auth 用户，先备份并审查对象及迁移历史，避免覆盖现有数据。

3. 使用 trusted operator 将 Auth 用户 UUID 加入 `profiles`，仅在受信 SQL 控制台执行：

```sql
insert into public.profiles(id) values ('替换为真实所有者Auth UUID');
```

4. 配置上方列出的 Vercel 环境变量后重新构建部署。内容页面及内容、搜索、备份和媒体接口都需要所有者认证；匿名 GET/HEAD 返回 401。不要通过记录标记或 public bucket 开放访问。
5. Supabase SQL 迁移、备份恢复结构、以及本地数据导入是分开的操作。Vercel 部署不会自动执行数据库迁移，也不会自动把 SQLite、JSON 或媒体文件迁入云端。迁移本地收藏前，分别备份 JSON 和原文件，按云端 owner 路径重新上传媒体并维护 ID 与引用；核对迁移历史和 `restore_backup` RPC 后再导入数据。

官方参考：<https://supabase.com/docs/guides/auth/server-side/nextjs>、<https://supabase.com/docs/guides/database/postgres/row-level-security>、<https://supabase.com/docs/guides/storage/security/access-control>、<https://supabase.com/docs/guides/storage/uploads/file-limits>。网络未成功读取官方页面时应在部署前重新核对，不把链接本身当作当前版本验证。

## 上线验收

先通过本地构建与测试，再在真实项目逐项验证：所有者登录/退出/重置；匿名及非所有者身份无法读取内容或媒体，包括标记为公开的旧记录；owner_id 和路径伪造被拒绝；UPDATE 不能夺取其他行；公开 object URL 不可读；所有者图片/音频/视频实际播放及 Range 拖动；恢复事务一处错误整体回滚；媒体删除引用保护；Cookie 在 HTTPS 为 Secure；日志与浏览器包没有密钥；重启后数据仍在。测试完检查产生的文件和测试用户，保留需要的审计记录。

Supabase Auth/Storage 网络与真实套餐尚未配置的情况下，云端能力只能称为已实现接入和迁移，不能称为已上线或生产验证。任何外部发布、公共分享都由所有者明确决定。
