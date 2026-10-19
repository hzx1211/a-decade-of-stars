# 十余年星途纪念馆

「张杰勇敢飞，星星永相随。」一个默认私人的个人音乐、影像与记忆空间。用户已确认从 **2009 年**开始喜欢张杰；这一年仅作为可修改的星途起点，网站不会据此生成任何经历、作品或演唱会记录。

首期采用真实 SQLite 数据库和本机媒体目录，可立即运行；保留 Supabase Auth、PostgreSQL、私有 Storage 接入。初始收藏为空。首页参考所有者提供的演唱会海报和“小北斗”拼图配色，使用深海蓝、银灰、暖金；这两张参考图不在网页中展示。页面展示所有者另行提供的两张现场照片，并以指定的蓝色双片衬线 V 作为站点标志和主视觉。照片放在本机私有目录，由登录后的认证接口读取，不会自动写成收藏记录；提供图片不代表网站取得了公开传播许可。主照片缺失时，首页使用 Twinklestellar 拍摄、以 CC BY-SA 4.0 开放许可的张杰照片作为替补。该许可照片的来源、处理与许可见 [素材署名](assets/licensed/ATTRIBUTION.md) 和网站「照片来源与版权」页。网站与张杰本人、工作室、唱片公司及官方团队无隶属关系。

## 运行

需要 Node.js **22.13 或更高版本**（本地数据库使用 `node:sqlite`），以及 npm。

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

打开 **http://127.0.0.1:3000**（本机 3000 端口）。首次打开时自行创建所有者邮箱和至少 12 字符的密码；此流程只能直接从 loopback 访问，不能经代理，且账号创建后即关闭注册。没有预置账号或密码。设置了 `APP_ORIGIN` 时，浏览器地址须与配置完全一致；若改用 `localhost`，相应改为 `http://localhost:3000`。未设置 `APP_ORIGIN` 时，本机请求按实际 Host 和监听端口校验，支持直接使用 `127.0.0.1` 或 `localhost`。

Windows 也可运行 `scripts/start.ps1` 或双击 `scripts/start.cmd`。数据默认保存在 `.data/museum.sqlite` 和 `.data/media/`；开发与生产启动共用该目录。请勿删除 `.data`，不要提交它到版本库。修改数据目录时使用 `STARS_DATA_DIR` 绝对路径，并重启应用。

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm start
```

运行端到端测试时应用使用独立的 3001 端口和 `.test-data/` 目录，不改动私人 `.data`。执行 `npm run build` 后，还可用 `npm run test:local-origin` 验证未配置 `APP_ORIGIN` 的生产启动与浏览器首次创建账号，使用独立的 3002 端口和测试数据库。首次运行浏览器测试可执行 `npx playwright install chromium`；Windows 已安装 Chrome 时配置会自动使用它。详细测试范围与实际执行结果见 [docs/TESTING.md](docs/TESTING.md)。

## 使用

登录后可管理歌曲、专辑、视频、照片、年份章节、时间轴、演唱会回忆、信件、日记、纪念日及纪念册。音乐馆点击「上传歌曲」、影像馆点击「上传演唱会视频」、照片馆点击「添加照片」，选择或拖入本地文件，确认标题并填写权利人与使用依据，即可上传并建立记录。现有歌曲也可直接点「添加音频」，保留原年份、专辑和标签。作品链接与本地文件分别记录，外部素材不会自动下载。

音乐馆的星轨唱片台就是播放器：点击唱片播放或暂停，可在台内切歌、拖动进度及调整音量。点击列表中的歌曲标题、编号或行内空白，会同步上方唱片台；有音频时开始播放，没有音频时显示「添加音频」，保留原有资料。歌曲资料仍可通过详情入口查看。唱片只在实际播放时转动；唱片台、歌曲列表与底部播放器共用同一份选曲和播放状态，通过站内导航切换页面时继续播放。底部播放条闲置 4 秒或浏览页面时自动收成右下角的小图标，歌曲继续播放；点击图标可展开，悬停或键盘操作期间保留控件，也可手动收起或停止关闭。刷新页面不会自动播放。视频使用浏览器播放器，照片支持灯箱与左右切换。音视频文件需要私人保存及 `private_playback` 使用范围；文件仍由服务端校验并通过认证接口读取。

首页「更换首页照片」可直达设置中的主视觉区，支持分别选择桌面与手机照片和预览裁剪；清空选择后回到默认现场照，若主照片未提供则显示有许可的替补照片。全站使用蓝色星海，包含持续起伏的灯海、星芒和间歇流星；可在设置关闭动效，并尊重系统减少动态效果偏好。自行上传的照片通过私人媒体 API 展示，不使用共享图片优化器缓存。

星海背景支持私人生成图片关键帧，分镜与实际生成状态见 [背景分镜](docs/starsea-background-prompts.md)。图片就绪后通过认证接口加载，解码成功才参与叠化；未生成或加载失败时继续显示实时灯海。生成使用单独的图像 API，本地运行网站不需要 API 密钥；密钥只在生成时从本机环境变量读取，不写入源码或前端。

设置可调整起始年份、主题、动画、首页顺序与精选内容。备份为显式下载的 JSON，恢复先预览再确认，按 ID 合并，不清空现有数据。**JSON 不含媒体文件本身**，媒体须另外备份。纪念册只导出主动选入的记录，打印 PDF 由浏览器完成。

## 架构与云端接入

Next.js App Router、React、TypeScript、Zod、Lucide；本地通过服务端 `node:sqlite` 持久化，云端使用 `@supabase/ssr` 和 `@supabase/supabase-js`。具体版本由 `package-lock.json` 固定。

目录：`app/` 路由和 API，`components/` 工作区与播放器，`lib/server/` 身份与数据操作，`lib/validation/` 校验，`supabase/migrations/` PostgreSQL/RLS/Storage，`tests/` 自动化测试，`docs/` 运维说明。

云端步骤：创建 Supabase 项目 → 关闭公开注册 → 受控创建 Auth 所有者 → 应用 SQL 迁移 → 将该用户 UUID 加入 `profiles` → 配置 `.env.local` 的云端变量并设置 `DATA_MODE=supabase`。**不能只改 DATA_MODE 就完成迁移**；本地数据不会自动上传云端。详见 [部署](docs/DEPLOYMENT.md)。没有有效 Supabase 凭证时，不把本地或模拟 PostgreSQL 测试称为云端验证。

文档：[数据模型](docs/DATA_MODEL.md) · [安全](docs/SECURITY.md) · [媒体上传](docs/MEDIA_UPLOAD.md) · [素材权利](docs/CONTENT_RIGHTS.md) · [部署](docs/DEPLOYMENT.md) · [备份恢复](docs/BACKUP_RESTORE.md) · [测试](docs/TESTING.md)。
