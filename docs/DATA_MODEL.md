# 数据模型

本地 SQLite 与云端 PostgreSQL 使用相同内容模型。作品、记忆、附件都由所有者身份决定归属；客户端不能设置 `owner_id`。对外 TypeScript/JSON 字段采用 camelCase，SQL 列采用 snake_case。

| 表 | 关键字段 | 作用 |
| --- | --- | --- |
| `profiles`（云端） | `id → auth.users.id`、唯一且为真的 `singleton` | 受控的单一所有者 allowlist，不允许应用用户修改 |
| `owners`（本地） | `id`、唯一邮箱、scrypt 密码散列 | 首次本机创建的唯一账号 |
| `sessions`（本地） | token SHA-256 散列、owner、到期时间 | HttpOnly Cookie 会话；不保存明文 session token |
| `entries` | UUID `id`、`owner_id`、`kind`、`title`、`data`、`favorite`、时间戳 | 所有作品与记忆 |
| `media_assets` | UUID、owner、filename、MIME、size、type、storage_path、来源与许可字段 | 私人文件元数据；文件内容不进入常规数据表 |
| `site_settings` | `owner_id` 主键、`settings`、`updated_at` | 主题、2009 起点、首页配置、上传上限 |

逻辑实体合并进 `entries`：`music`、`albums`、`videos`、`photos`、`journey`、`timeline`、`concerts`、`letters`、`journal`、`milestones`、`memory-book`。当前版本不提供公开内容表或公开读取接口。标签位于 `data.tags`；纪念册选择顺序位于 `data.itemIds`。这种结构减少重复 CRUD，同时保留 kind 校验与关系验证。

`data` 通过 Zod 严格校验；未知键被拒绝。通用字段包括描述、个人笔记、部分日期及日期精度、年份、分类、标签、权利字段；音乐可关联 `albumId`、音频 `assetId`；照片关联图片 `assetId`；视频关联视频 `assetId` 或外部链接；封面统一 `coverAssetId`。`relatedIds`、`itemIds`、`chapters` 关联实际已存在且属于本人的记录。标题、日期、数组数量、URL、媒体类型、关联关系都在服务端验证。

SQL 使用外键约束 owner、类型 CHECK、owner/kind 索引和搜索索引。ID、owner、entry kind 不可修改。数据库延迟约束触发器验证 JSON 关联，允许一次恢复事务先插入子记录再插入父记录，但事务结束不能遗留断链；删除被引用的条目或文件会失败。修改关联后再删除原对象。

文件路径为 `<owner UUID>/<asset UUID>.<extension>`，本地放在 `.data/media/` 下，云端放在 `private-media` Bucket。SQL 的 100 MB 单文件上限与 Bucket 上限是保守初值，应用默认图片 10 MB、音频 50 MB、视频 100 MB，最终有效限制取服务端上限与站点设置较小值；云服务和托管请求限制还可能更低。

`allowed_use_scope` 为 JSON 字符串数组：`metadata_only`、`personal_collection`、`private_storage`、`private_playback`、`official_embed`、`public_display`、`link_only`。权利状态为 `unknown`、`personal_only`、`licensed`、`do_not_publish`。状态只是管理记录，不等于取得许可。
