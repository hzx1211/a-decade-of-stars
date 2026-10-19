# 测试与验收

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run test:local-origin
```

Vitest 覆盖数据校验与迁移权限。Playwright 使用实际 Next.js API/页面、真实 SQLite 与真实媒体 bytes，不是 Mock 生产数据。浏览器默认使用已安装 Chrome（Windows），否则用 Playwright Chromium；可通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定浏览器。

端到端测试在 127.0.0.1:3001 启动独立实例，使用 `.test-data/playwright-时间戳/`；不会修改正式 `.data`。自动生成的测试 fixtures 为原创 PNG、合成 WAV、浏览器产生的短 WebM，不进入正式收藏。若存在所有者提供的主题图片，3002 生产模式回归只将服务用文件 `stage.jpg`、`beidou.jpg` 和 `v-reference.png` 复制到隔离测试目录，不复制原始 PNG 备份或收藏媒体。测试检查认证读取、横竖照片实际方向和浏览器解码。若需保留故障证据查看 `test-results/` 的截图与 trace；这些目录可能包含测试文字和主题图片，仅作本地验收，默认忽略版本控制。

`test:local-origin` 使用已构建的生产服务、127.0.0.1:3002 和独立 `.test-data/local-origin-*`，强制清空 `APP_ORIGIN`。浏览器实际首次创建账号、退出、重新登录，并通过只读 SQLite 连接确认会话创建和删除；同时验证缺失、恶意、别名不匹配、不同端口的 Origin 被拒绝。还验证主题图片接口的匿名和伪造会话 GET/HEAD 拒绝、公开静态路径不可用、旧 poster 路由和原始备份文件不可读、横图和竖图实际解码、主图缺失时许可照片回退，以及伴图独立读取和完整显示。桌面和 Pixel 7 均检查横向溢出；所有公开页面的 V 与主标志轮廓一致，首页和登录页的大 V 在桌面至少 260px、手机至少 160px。测试不记录凭证或会话 token。

检查范围：单owner创建与拒绝二次注册、登录退出、未登录 API/私人页面、同源限制、伪造 owner/session、实际 CRUD 与引用保护、媒体签名/MIME/大小与未核实权限、Range 播放与私有读取、备份结构/预览/确认/缺失媒体/事务恢复、重新获取和刷新后持久化，以及桌面/手机布局与主要创作流程。

PostgreSQL 若通过 PGlite 运行迁移测试，仅证明 SQL 在模拟 auth/storage schema 下的实际 PostgreSQL RLS、约束与事务行为；**没有把模拟结果称作真实 Supabase Auth、Storage 或网络集成验证**。后者需要 DEPLOYMENT.md 中的实际云端凭证、第二用户和上线验收。

手工验收：首次创建私人账号；起点显示2009且可改；添加有权照片并在灯箱用方向键/Esc浏览；上传自己原创音频和视频，在真实播放器播放/暂停/拖动；保存日记和信件，刷新再搜索；建立年份章节并关联已有作品；建纪念册只选需要条目并打印预览；调整首页精选与模块顺序；导出JSON和真实媒体备份并在独立数据目录恢复；退出后确认私人页与媒体不可访问。编码不支持、缺少文件、超限上传、网络失败均须如实报错。

2026-10-09 实际执行结果：TypeScript 检查、ESLint、生产构建通过；Vitest **21 / 21**（4 项输入、9 项真实 PostgreSQL 权限/事务、2 项组件交互/选择性导出隐私、6 项来源与本机初始化边界）；Playwright 常规流程 **9 / 9**（7 项真实 SQLite/API、桌面和 Pixel 7 手机各一条完整创作流程），最后完整浏览器测试用时 52.7 秒；未配置 `APP_ORIGIN` 的生产回归 **1 / 1**，用时 6.4 秒。音乐和 WebM 均验证真实播放时间推进、暂停及跳转，而非仅检查播放器元素存在。灯箱验证多张切换及 Esc；编辑、刷新、搜索、纪念册选择和未选私信排除均通过。

纪念册实际生成 3 页 A4 测试 PDF，使用 Poppler 渲染全部页面并视觉检查，只有封面及主动选择的照片、2009 章节；此为原创测试素材的验收证据，不是网站所有者的真实纪念册。桌面、手机截图与生产只读验收记录在 `verification/`。正式 3000 端口生产构建的私人 API 均返回 401，未登录私人页面跳转登录，账号仍等待用户首次创建；测试没有写入正式账号。

来源错误修复后，正式服务上的 Chrome 分别从 `127.0.0.1:3000` 和 `localhost:3000` 发出空表单请求，均进入输入校验（400），不再误报来源错误；跨源和错端口请求仍返回 403。正式账号与收藏保持空白，等待所有者自行创建。

本地账号重置 CLI 另在独立 `.test-data/cli-reset-proof` 实际运行：隐藏双次密码输入、scrypt 散列、原库快照和会话失效均已验证。结构化结果见 `docs/verification.json`。未配置 Supabase，云端认证、邮件、Storage 网络、套餐上限及公网部署 **未验证**。测试开发服务器可能显示 Watchpack 对 Windows 系统目录的无效扫描警告以及 SQLite experimental 提示，未影响上述结果。

2026-10-10 上一版黑白/舞台红主题验收：TypeScript、ESLint 和生产构建通过；Vitest 21/21、常规 Playwright 9/9（51.3 秒）、生产回归 1/1（8.7 秒）。当时验证内置照片的 GET/HEAD 与伪造会话保护、JPEG 实际解码、部署 trace 包含许可照片且排除私人目录、桌面/手机不同上传照片的选择与实际加载、裁剪位置保存、取消选图返回内置照片、纸白主题。该记录只描述当时的设计版本；当前首页使用两张所有者另行提供的现场照片，参考海报与小北斗拼图只提供配色灵感，指定的蓝色双片衬线 V 作为网站标志与主视觉。相关检查以本节当前测试代码和新一轮运行结果为准。

上一版主题截图：`verification/concert-desktop.png`、`concert-mobile.png`、`concert-paper.png`、`concert-landing.png`、`concert-login.png`。许可照片的来源及处理详见 `assets/licensed/ATTRIBUTION.md`；主题图与许可照片都不会自动添加为收藏记录。

2026-10-15 蓝色星海增强：全量 TypeScript、ESLint、55 项单元测试与生产构建通过。新增私有背景帧接口的 6 项安全测试，覆盖 GET/HEAD 认证、目录边界、文件类型、缺失清单与 Windows junction 拒绝。独立生产浏览器测试 6/6 通过，覆盖桌面和手机、蓝色画布实际变化、图片解码和叠化、空清单/坏图回退、减少动态效果和设置关闭动画时的静态状态、点击穿透及横向溢出。测试配置为 `playwright.starsea.config.ts`，使用 3006 端口、`.next-test-starsea` 与新建 `.test-data/starsea-*`，不修改所有者账号、歌曲或正式 `.data`。

背景帧 API 在此轮实际返回空清单：尚未调用图像 API，也未生成 AI 图片。图片叠化测试使用测试代码自制的抽象蓝色 PNG，通过浏览器路由替身提供，不进入网站素材或收藏。实际画布效果与图片测试证据分开标注，见 `verification/starsea-v2/` 中的 PNG 和同名 JSON；文件名含 `canvas-only` / `empty-canvas` 的截图用于检查没有 AI 图片时的真实画布效果。图像 API 分镜与待执行命令见 [背景分镜](starsea-background-prompts.md)。

2026-10-10 本轮银蓝主题修订验收：指定蓝色分体衬线 V 作为 Logo 和首页大标志；最初海报与拼图仅用于配色参考，展示区域改用所有者新增的横向星雨现场照和纵向小北斗现场照。TypeScript、ESLint、Vitest 21/21、生产构建通过。隔离的生产模式浏览器回归 1/1（12.2 秒），验证桌面/手机的大 V、两张图片实际解码与完整显示、上传覆盖与恢复、主图缺失时许可照片回退、伴图独立可用、GET/HEAD 认证与旧参考路径不可读。部署 trace 未包含私人运行数据。生产 3000 端口已启动，入口/登录页 Chrome 实测无脚本错误和横向溢出；正式收藏保持空白。截图与当前验收记录位于忽略版本控制的 `verification/`。本轮没有配置或验证真实 Supabase 服务。
