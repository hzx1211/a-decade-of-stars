# 安全与私人访问

所有 `/app/**` 路由和内容、搜索、媒体、备份 API 都先在服务端验证所有者。页面不依赖前端隐藏按钮保护私人内容；未登录 API 返回 401，私人页面跳转登录。公开页面仅是登录、隐私、版权和非官方声明。

首页现场照片、V 参考图与内置许可照片均受保护。演唱会海报和小北斗拼图只作配色参考，不在网页展示。所有者提供的现场主图 `stage.jpg`、伴图 `beidou.jpg` 及 V 参考图 `v-reference.png` 保存在本机主题目录（默认 `.data/theme-media/`，可随 `STARS_DATA_DIR` 更改），不放进 `public`；固定资源由 `/api/theme-media/{stage,beidou,v-reference}` 在 `requireApiOwner()` 后读取。参考图原件 `original-poster.png`、`original-beidou.png` 和照片原件 `original-stage.png`、`original-companion.png` 不映射到任何读取路由。旧文件 `poster.jpg` 不再作为页面素材或读取路由。`/api/artist-portrait` 优先读取 `stage.jpg`，文件不存在时才回退到 `assets/licensed/` 中的开放许可照片；小北斗伴图独立提供，主图缺失不会隐藏伴图。用户图片和许可照片均不进入所有者媒体表、收藏或私人备份。GET 与 HEAD 对匿名及伪造会话均返回 401，成功响应为 `private, no-store`，不经过公开图片优化器。测试服务器只把可服务的固定主题图片复制到独立的 `.test-data` 目录，不复制正式数据库、原始 PNG 备份或收藏媒体。

本地首个账号只允许 loopback URL、Host 与 Origin，拒绝非本机转发来源及转发链；Next.js 自己添加的单个本机地址可接受。创建完毕不再注册第二个账号。密码使用随机盐 scrypt，会话是随机 token 的 SHA-256 散列；Cookie 为 HttpOnly、SameSite=Strict，HTTPS 部署时由 `APP_ORIGIN` 启用 Secure。会话有效期 7 天。设置、创建、编辑、上传、恢复等写操作验证同源 Origin；登录与创建账号有进程内速率限制。分布式部署需额外网关限速，当前限速不会跨进程同步。

`APP_ORIGIN` 已配置时，只接受该精确来源。未配置且框架请求 URL 为本机地址时，依据传入的 loopback Host 构造预期 Origin，并要求端口与监听端口一致，以兼容 Next.js 将 `127.0.0.1` 请求 URL 重建为 `localhost` 的情况。Origin 仍须与该 Host 的协议、主机、端口完全匹配，不将所有本机地址或端口互相视为同源。外部、畸形 Host 和 cross-site 请求被拒绝，不使用 `X-Forwarded-Host` 扩大来源范围。远程或反向代理部署须显式配置 HTTPS `APP_ORIGIN`。

忘记本地密码时，在应用停止后由持有数据目录权限的操作者运行 `npm run owner:reset`，按脚本提示重置；不要删除数据库换取登录。云端使用 Supabase Auth 的恢复邮件、回调与重设页面，须配置正确 redirect URL 与 SMTP。

云端使用 `@supabase/ssr` 服务端 Cookie 客户端，并通过 `auth.getUser()` 验证会话。授权同时要求受保护配置 `SUPABASE_OWNER_ID` 与只读 `profiles` allowlist 中的 UUID 一致。**不使用可编辑的 user_metadata 授予所有者权限**。`profiles.singleton` 唯一且必须为 true，防止意外配置第二个所有者。

迁移中的 `profiles`、`entries`、`media_assets`、`site_settings` 启用并强制 RLS。匿名角色没有表或 RPC 的授权；authenticated 必须是 allowlist 所有者。每张内容表的 SELECT、INSERT、UPDATE、DELETE 分开定义，UPDATE 同时验证旧行与新行 owner。触发器禁止修改 owner、ID、entry kind。`restore_backup` 为 **SECURITY INVOKER**，按调用者 RLS 执行，拒绝不属于当前 owner 的输入，不夺取冲突 ID；一处校验失败回滚整个事务。辅助触发器不开放为 RPC。

`private-media` Bucket 不是公开 Bucket。Storage 各 CRUD 策略同时校验 allowlist、对象 owner_id 和 UUID 路径；上传与替换仅接受指定扩展名。已登记到媒体表的文件禁止原地覆盖，替换需新建 asset。媒体元数据入库与恢复还会校验私有对象的路径、owner 和实际 size。读取使用认证媒体访问或短期签名 URL。猜测路径或使用公开 object URL 不应读取成功。先检查引用再删除数据库元数据，然后删除 Storage 文件；数据库仍有媒体记录时，策略拒绝删除对象。失败遗留孤儿文件时，按受控运维清理，不放宽 Bucket 权限。

生产 Data API 只暴露所需 schema。迁移主动撤回匿名表访问和函数执行；不要另加宽泛 GRANT、public SELECT 策略、SECURITY DEFINER 代理或绕过权限的 service_role 数据路径。Service role 会绕过 RLS，当前应用无需它。只有 URL 和 publishable key 允许 `NEXT_PUBLIC_`；owner ID、数据目录与秘密不进入客户端变量。publishable key 本身不是授权，安全依赖 Auth、RLS 和 Storage。

本地磁盘数据库与媒体未做应用层加密；操作系统账户、磁盘加密、权限和备份位置决定静态数据保护。不要把 `.data`、私人 JSON 导出或信件提交仓库。部署保持 HTTPS、私人备份和依赖补丁。测试证明范围见 TESTING.md；模拟 PostgreSQL 的权限检查不能替代真实 Supabase 的 Storage/Auth 集成验收。
