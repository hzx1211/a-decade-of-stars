# 部署

当前部署包含只读访客精选。首页和登录页提供访客入口；访客可以浏览明确公开且非草稿的记录及其直接关联媒体。新记录默认私人。管理、设置、备份、主题文件、背景帧、上传和写入仍要求唯一所有者登录。第七份迁移建立访客投影，第八份迁移为私有 Storage 的精选媒体提供受限 CDN 授权。

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
- `PUBLIC_MEDIA_READ_TOKEN`：服务端 Secret，至少 32 字节随机熵；其 SHA-256 摘要必须同步配置在 Supabase 的 `archive_public.media_read_access` 表中
- `APP_ORIGIN`：应用的规范 HTTPS 源，例如 `https://你的域名`
- `CLOUD_UPLOAD_LIMIT_MB=50`：云端上限必须大于 0 且不超过 50 MB；类型和站点设置还能进一步降低上限

`PUBLIC_MEDIA_READ_TOKEN` 必须是加密安全随机生成的字符串（至少 32 字节随机熵），只配置为 Vercel 的 server-side Secret。不要添加 `NEXT_PUBLIC_` 前缀，不要放入客户端属性、URL 或日志。Supabase 表中只保存此值 UTF-8 字节串的 SHA-256 小写十六进制摘要；Vercel Secret 和数据库摘要必须对应同一 token。轮换时同时更新两处并部署，避免不一致。变量缺失时访客媒体接口 fail closed 并返回 503。运行中的应用不需要 `service_role` 或其他 Supabase secret key；不要配置或暴露它们。项目要求 Node.js 22.13+，Vercel 云项目可选择 Node.js 24，并使用 Next.js Node runtime。

1. 建立 Supabase 项目，确认套餐数据库、Storage 配额、文件上限、流量及费用。先确定 HTTPS 应用域名并设置 Site URL 与 redirect URL：`https://你的域名/auth/callback`、`https://你的域名/auth/reset-password`。如需密码恢复邮件，配置 SMTP 并验证流程。
2. 通过 Supabase CLI 或可信 SQL 控制台按时间顺序应用迁移。先应用第一份；随后通过受控管理流程创建唯一 Auth 所有者；再继续依序应用剩余迁移。所有迁移完成前不要接入线上流量：

   1. `supabase/migrations/202610090001_private_memorial.sql`
   2. `supabase/migrations/202610180001_optional_media_metadata.sql`
   3. `supabase/migrations/202610200001_selected_public_readonly.sql`
   4. `supabase/migrations/20261023110248_private_cloud_release.sql`
   5. `supabase/migrations/20261023111432_single_owner_auth_registration.sql`
   6. `supabase/migrations/20261023112230_defer_owner_registration_validation.sql`
   7. `supabase/migrations/20261023143940_selected_visitor_projection.sql`
   8. `supabase/migrations/20261023145303_visitor_media_cdn_authorization.sql`

   第 5、6 份迁移继续在数据库层限制额外 Auth 用户，并在事务提交时检查唯一所有者注册状态。第 7 份迁移建立受限只读访客投影，不创建访客账号、不开放私有表给匿名角色，也不改变单所有者注册保护。第 8 份迁移创建只存摘要的 `archive_public.media_read_access` 配置表，并将 Storage 权限限制到精选媒体的窄 CDN 授权流程。普通匿名 `info`、签名 URL 和列表访问仍被拒绝。访客只看 `isPublic=true` 且状态不是 `draft` 的记录；原有公开选择会保留。若项目已有表或 Auth 用户，先备份并审查对象及迁移历史，避免覆盖现有数据。

3. 使用 trusted operator 将 Auth 用户 UUID 加入 `profiles`，仅在受信 SQL 控制台执行：

```sql
insert into public.profiles(id) values ('替换为真实所有者Auth UUID');
```

4. 创建至少 32 字节随机熵的 `PUBLIC_MEDIA_READ_TOKEN`，将原值设为 Vercel Secret；仅在可信 Supabase SQL 控制台写入同一 token 的 SHA-256 小写十六进制摘要。不要把原值写入 SQL、浏览器、URL 或日志：

```sql
insert into archive_public.media_read_access(singleton,token_sha256)
values (true,'替换为 PUBLIC_MEDIA_READ_TOKEN 的 64 位小写 SHA-256 十六进制摘要')
on conflict (singleton) do update set token_sha256=excluded.token_sha256;
```

5. 配置其余 Vercel 环境变量并重新构建部署。通过首页或登录页访客入口验证：访客可以只读打开精选内容工作区；设置、备份、上传、写入、主题媒体和背景帧仍拒绝访客访问。访客媒体只通过应用代理读取；代理通过服务端 token 对精确对象路径调用 GET 方法的内部 GET-info 检查，再转发选中的对象。Bucket 仍为 private；普通匿名 info、签名 URL、列表和写入操作继续拒绝，token 不授予私有文件访问权限，也不会向浏览器发放长效签名 URL。每次授权都按当前精选状态复核；不要将 Bucket 改成 public。
6. Supabase SQL 迁移、备份恢复结构、以及本地数据导入是分开的操作。Vercel 部署不会自动执行数据库迁移，也不会自动把 SQLite、JSON 或媒体文件迁入云端。迁移本地收藏前，分别备份 JSON 和原文件，按云端 owner 路径重新上传媒体并维护 ID 与引用；核对迁移历史和 `restore_backup` RPC 后再导入数据。

官方参考：<https://supabase.com/docs/guides/auth/server-side/nextjs>、<https://supabase.com/docs/guides/database/postgres/row-level-security>、<https://supabase.com/docs/guides/storage/security/access-control>、<https://supabase.com/docs/guides/storage/uploads/file-limits>。网络未成功读取官方页面时应在部署前重新核对，不把链接本身当作当前版本验证。

## 上线验收

先通过本地构建与测试，再在真实项目逐项验证：所有者登录/退出/重置；匿名可读取精选非草稿记录而看不到私密记录、草稿、笔记、权利证明、所有者标识、原文件名和存储路径；公开的关联 ID 只指向访客可见记录；匿名只能 GET/HEAD 直接关联媒体，不能签名、列出或读取对象信息；撤回精选或解除媒体引用后，下次读取返回 404；其他写操作、上传、设置、备份、主题媒体和背景帧仍受保护；伪造所有者 ID 和路径被拒绝；UPDATE 不能夺取其他行；公开 object URL 不可读；所有者图片/音频/视频实际播放及 Range 拖动；恢复事务一处错误整体回滚；媒体删除引用保护；Cookie 在 HTTPS 为 Secure；日志与浏览器包没有密钥；重启后数据仍在。测试完检查产生的文件和测试用户，保留需要的审计记录。

第八份迁移的 token 授权已完成有限的真实 Supabase Storage 检查：配置 token 的 Range GET 返回 206、完整 GET 返回 200；没有 token 的内部 GET-info 返回 400 `NoSuchKey`。这些结果只覆盖该 CDN 授权流程，完整的新 Vercel 线上验收仍待完成。历史单所有者认证保护继续有效。任何外部发布、公共分享都由所有者明确决定。
