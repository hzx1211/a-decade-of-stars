# 安全与私人访问

所有者与访客使用不同的服务端数据读取路径。访客可从首页或登录页进入只读工作区，并读取所有者明确公开且非草稿的记录；其他 `/app/**` 管理路由以及写入、搜索管理、媒体上传、备份、设置、主题媒体和背景帧仍要求所有者认证。保护依赖服务端授权和受限数据库投影，不依赖隐藏前端按钮。访客没有所有者登录状态，也不会因访问访客页面获得所有者权限。

首页现场照片、V 参考图与内置许可照片的处理不同。演唱会海报和小北斗拼图只作配色参考，不在网页展示。所有者提供的现场主图 `stage.jpg`、伴图 `beidou.jpg` 及 V 参考图 `v-reference.png` 保存在本机主题目录（默认 `.data/theme-media/`，可随 `STARS_DATA_DIR` 更改），不放进 `public`；固定资源由 `/api/theme-media/{stage,beidou,v-reference}` 在 `requireApiOwner()` 后读取，访客不可读取。参考图原件 `original-poster.png`、`original-beidou.png` 和照片原件 `original-stage.png`、`original-companion.png` 不映射到任何读取路由。旧文件 `poster.jpg` 不再作为页面素材或读取路由。访客访问 `/api/artist-portrait` 时只能得到 `assets/licensed/` 中带开放许可的替补照片；不会读取私人 `stage.jpg`。所有者访问时保留现有私人主题照片。小北斗伴图与星海分镜帧仍受所有者认证保护。用户图片和许可照片均不进入所有者媒体表、收藏或私人备份。成功响应为 `private, no-store`，不经过公开图片优化器。测试服务器只把可服务的固定主题图片复制到独立的 `.test-data` 目录，不复制正式数据库、原始 PNG 备份或收藏媒体。

本地首个账号只允许 loopback URL、Host 与 Origin，拒绝非本机转发来源及转发链；Next.js 自己添加的单个本机地址可接受。创建完毕不再注册第二个账号。密码使用随机盐 scrypt，会话是随机 token 的 SHA-256 散列；Cookie 为 HttpOnly、SameSite=Strict，HTTPS 部署时由 `APP_ORIGIN` 启用 Secure。会话有效期 7 天。设置、创建、编辑、上传、恢复等写操作验证同源 Origin；登录与创建账号有进程内速率限制。分布式部署需额外网关限速，当前限速不会跨进程同步。

`APP_ORIGIN` 已配置时，只接受该精确来源。未配置且框架请求 URL 为本机地址时，依据传入的 loopback Host 构造预期 Origin，并要求端口与监听端口一致，以兼容 Next.js 将 `127.0.0.1` 请求 URL 重建为 `localhost` 的情况。Origin 仍须与该 Host 的协议、主机、端口完全匹配，不将所有本机地址或端口互相视为同源。外部、畸形 Host 和 cross-site 请求被拒绝，不使用 `X-Forwarded-Host` 扩大来源范围。远程或反向代理部署须显式配置 HTTPS `APP_ORIGIN`。

忘记本地密码时，在应用停止后由持有数据目录权限的操作者运行 `npm run owner:reset`，按脚本提示重置；不要删除数据库换取登录。云端使用 Supabase Auth 的恢复邮件、回调与重设页面，须配置正确 redirect URL 与 SMTP。

云端使用 `@supabase/ssr` 服务端 Cookie 客户端，并通过 `auth.getUser()` 验证会话。授权同时要求受保护配置 `SUPABASE_OWNER_ID` 与只读 `profiles` allowlist 中的 UUID 一致。**不使用可编辑的 user_metadata 授予所有者权限**。`profiles.singleton` 唯一且必须为 true，防止意外配置第二个所有者。

迁移中的 `profiles`、`entries`、`media_assets`、`site_settings` 启用并强制 RLS。匿名角色不能直接读取这些底层私有表，也不能执行写入或备份 RPC；authenticated 必须是 allowlist 唯一所有者。第七份迁移增加一个不登录、无 RLS 绕过能力的受限投影角色，访客只能查询经过筛选的 `public_entries`、`public_media_assets` 和 `public_site_settings` 视图。视图只包含允许公开的条目字段，并排除草稿；引用到私有或草稿记录的关联 ID 会省略。访客条目中的 owner ID 为空，不泄露所有者 UUID。

Supabase Advisor 会将上述三个 `public` 投影视图报告为 `security_definer_view`（0010）ERROR。这些视图有意由 `archive_visitor_projection` 持有：它是 `NOLOGIN`、`NOINHERIT`、`NOBYPASSRLS` 的受限角色，只能读取启用并强制 RLS 的底层表，且只能读受筛选策略允许的列与行；`anon` 没有底层表读取权限，也不是该角色成员。视图只投影白名单字段。不要机械地将其改为 `security_invoker` 后授予 `anon` 原表读取权，这会暴露私密字段（包括个人笔记）。维护时不得给投影角色写权限、`BYPASSRLS` 或 `anon` membership。这个 Advisor 告警已针对角色权限、RLS 和真实 REST 读取结果人工核对；该核对不表示所有安全告警均已清零。相关检查说明见 [Supabase Database Linter remediation](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)。

新记录的 `isPublic` 默认为 false；仅所有者可选择公开。公开状态为 true 但 `status` 是 `draft` 的记录仍不对访客开放。个人笔记、媒体来源与权利证明、收藏状态、所有者标识、原文件名及存储路径不会出现在公开投影中。公开媒体使用合成文件名，且只包括非草稿公开记录的 `assetId` 或 `coverAssetId` 直接引用的媒体；首页主题选择本身不会公开一份媒体。`restore_backup` 为 **SECURITY INVOKER**，按调用者 RLS 执行，拒绝不属于当前 owner 的输入，不夺取冲突 ID；一处校验失败回滚整个事务。辅助触发器不开放为 RPC。

`private-media` Bucket 始终为 private。所有者上传/替换/删除策略校验 allowlist、对象 owner ID 和 UUID 路径；上传与替换仅接受指定扩展名。已登记到媒体表的文件禁止原地覆盖，替换需新建 asset。媒体元数据入库与恢复还会校验私有对象的路径、owner 和实际 size。所有者读取使用认证接口或短期签名 URL。访客浏览器只向应用媒体接口请求 GET/HEAD；应用代理在服务端携带 `PUBLIC_MEDIA_READ_TOKEN`，调用内部 CDN GET-info 授权后读取精选媒体。普通匿名 info、签名 URL、列表和写入仍拒绝；token 不允许读取私有或未精选对象，不返回长效签名 URL。Storage 策略检查精确 GET-info 路径、GET 方法、token SHA-256 摘要和当前公开非草稿引用；撤回公开或解除引用后授权即失效。token 至少有 32 字节随机熵，只存于服务器 Secret；数据库表 `archive_public.media_read_access` 仅保存其 SHA-256 摘要。不要把 token 放入客户端变量、URL、响应或日志。缺少服务端 token 时媒体读取 fail closed 并返回 503。猜测路径或使用 public object URL 不应读取成功。先检查引用再删除数据库元数据，然后删除 Storage 文件；数据库仍有媒体记录时，策略拒绝删除对象。失败遗留孤儿文件时，按受控运维清理，不放宽 Bucket 权限。

生产 Data API 只暴露所需 schema。迁移撤回匿名底层表与备份函数权限；匿名可执行的两个内部辅助函数 `archive_public.is_selected_media_object` 与 `archive_public.has_media_read_token` 位于不暴露给 Data API 的 schema，且都只返回布尔值。前者供 Storage 策略检查对象是否仍被精选记录引用；后者校验代理请求头中的 token 摘要是否匹配数据库配置。二者不返回记录、所有者标识、路径或 token。不要另加宽泛 GRANT、public SELECT 策略、SECURITY DEFINER 代理或绕过权限的 service_role 数据路径。Service role 会绕过 RLS，当前应用无需它。只有 URL 和 publishable key 允许 `NEXT_PUBLIC_`；owner ID、数据目录与秘密不进入客户端变量。publishable key 本身不是授权，安全依赖 Auth、RLS 和 Storage。

本地磁盘数据库与媒体未做应用层加密；操作系统账户、磁盘加密、权限和备份位置决定静态数据保护。不要把 `.data`、私人 JSON 导出或信件提交仓库。部署保持 HTTPS、私人备份和依赖补丁。测试证明范围见 TESTING.md；模拟 PostgreSQL 的权限检查不能替代真实 Supabase 的 Storage/Auth 集成验收。
