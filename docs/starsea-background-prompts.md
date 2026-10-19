# 蓝色星海背景分镜

用途：私人张杰纪念馆的全屏环境背景。沿用现有 V 标、真人照片和页面结构，不生成或重画艺人、演唱会照片、商标或文字。

生成方式：imagegen 技能的 API / CLI 备用模式，默认 `gpt-image-2`。计划 4 张 2048 × 1152 的关键帧；先生成第一帧，再以第一帧为编辑输入生成其余三帧，保持构图与星点位置。网页以缓慢叠化连接关键帧，另由实时画布提供星光、光浪与流星。关键帧不是视频的全部中间帧。

状态：提示词与接入已准备。只有成功调用图像 API 并验收后，才能把图像标记为已生成。缺少密钥时保留实时画布背景。

## 共同约束

- 深海蓝、钴蓝、电光蓝、冰蓝和少量冷白光。避免紫色、粉色、金色和红色。
- 画面是抽象的演唱会蓝色星海，不是真实演唱会记录，不包含人物或可辨识场馆。
- 星海在下半部展开，明亮的弧形光浪延伸到两侧。上部仍有可见光线与细节，中央区域保持深蓝，便于白色文字阅读。
- 星点自然散布，避免规则点阵、网格、科技仪表、科幻飞船与普通宇宙壁纸的行星。
- 光芒有清晰的亮核、细腻的辉光与少量衍射星芒，不使用整屏白雾。
- 所有帧固定镜头、地平线、星点布局和主光源位置。只改变光浪的明暗和局部光芒强度。
- 无文字、数字、V 标、标语、水印、边框或界面元素。保留现有网站的原始 V 标。

## 帧 01 星海初亮

```text
Use case: stylized-concept
Asset type: cinematic full-bleed environmental background for a private blue concert fan archive, 16:9 landscape.
Primary request: an original, luminous cobalt-blue sea of concert-like lights, extraordinarily refined and brilliant, with emotional scale and realistic optical depth. This is abstract environmental artwork, not a photograph of a real concert.
Scene: a vast ocean of countless irregularly scattered sapphire and ice-blue light points opens from a distant softly curved horizon at 58 percent image height toward the viewer. Several broad gently curved luminous waves shimmer across the lower half, dense and jewel-like in the distance, larger and beautifully defocused near the lower edges. Very fine blue atmospheric filaments connect the light without creating a grid. A few clean four-point diffraction stars glisten at the lateral edges and lower third. Delicate sweeping stage-light shafts rise at the far sides into an expansive midnight-blue upper sky.
Composition: locked wide camera, balanced and immersive. Preserve deep midnight-blue negative space in the central upper half for readable white website text, but include subtle visible blue atmosphere there. The most brilliant light belongs to the lower third and outer sides. The scene must also work when cropped to its central 40 percent on a phone.
Lighting: luminous ice-white cores, electric cobalt bloom, soft atmospheric scattering, rich dark blues, cinematic contrast, exceptionally fine detail, no blown-out large areas. A gentle first wave is already visibly bright.
Palette: midnight navy, sapphire, cobalt, electric blue, ice blue, a small amount of cool white. No violet, magenta, pink, gold or red.
Constraints: no people, no faces, no recognizable venue, no artist likeness, no planets, no spacecraft, no floating UI, no rigid dot matrix, no lettering, no numbers, no logo, no V symbol, no watermark, no border.
```

## 帧 02 光浪涌起

```text
Use case: lighting-weather
Asset type: second keyframe of the same blue concert-light-sea website background.
Input image 1 is the first keyframe and the exact composition to preserve.
Change only the illumination: the broad curved blue light wave across the lower half gently crests, its electric-blue glow grows richer and extends toward the lower sides; tiny ice-white light cores become a little more radiant. Slightly illuminate the existing side shafts. Keep the upper central reading area midnight blue with subtle atmosphere.
Preserve exactly the camera, horizon position, spatial geometry, existing light-point positions, star positions, color family and crop. Do not add or remove objects. Keep light waves continuous with image 1. The increase is lyrical and detailed, not a screen-wide flash. No violet, red, text, symbols, logos, V mark, people or watermark.
```

## 帧 03 星芒绽放

```text
Use case: lighting-weather
Asset type: third keyframe of the same blue concert-light-sea website background.
Input image 1 is the first keyframe and the exact composition to preserve.
Change only the illumination: the existing lower-edge and side diffraction stars briefly reach their most beautiful ice-blue radiance; a soft band of luminous cobalt travels through the existing curved sea at mid-to-lower depth. Preserve tiny crisp cores surrounded by delicate optical bloom. Keep existing side shafts airy, blue and elegant, and leave the central upper reading area deep navy.
Preserve exactly the camera, horizon position, spatial geometry, existing light-point positions, star positions, color family and crop. Do not add new stars or new objects. Avoid excessive white coverage. This is the luminous peak of a calm cinematic loop, not a strobe. No purple, pink, gold, red, text, symbols, logos, V mark, people or watermark.
```

## 帧 04 星海回响

```text
Use case: lighting-weather
Asset type: fourth keyframe of a seamless blue concert-light-sea website background loop.
Input image 1 is the first keyframe and the exact composition to preserve.
Change only the illumination: let the existing curved cobalt light wave settle into a finely sparkling glow, close to the first frame's brightness, with a soft ice-blue echo at the far horizon. Ease the existing side diffraction stars back to their original intensity so that a crossfade back to input image 1 feels continuous. Keep the lower sea visibly luminous and preserve the dark-blue upper-center reading area.
Preserve exactly the camera, horizon position, geometry, existing light-point and star positions, color family and crop. No new objects or camera movement. No purple, pink, gold, red, text, symbols, logos, V mark, people or watermark.
```

## 文件与接入

- API 原始输出：`output/imagegen/starsea-v2/starsea-01.webp` 至 `starsea-04.webp`。
- 验收后复制到：`assets/generated/starsea-v2/`。
- 同目录的 `manifest.json` 只列出真实生成且已验收的文件：

```json
{
  "version": 1,
  "frames": [
    {"file": "starsea-01.webp", "label": "星海初亮"},
    {"file": "starsea-02.webp", "label": "光浪涌起"},
    {"file": "starsea-03.webp", "label": "星芒绽放"},
    {"file": "starsea-04.webp", "label": "星海回响"}
  ]
}
```

图片通过需要登录的 `/api/starsea-frames` 与 `/api/starsea-frames/[frame]` 读取，不放进 public。密钥只从本机环境读取，禁止写入提示词、源码、图片清单或命令日志。

## API 执行命令

需要 Python、`openai`、`pillow` 和本机配置的 `OPENAI_API_KEY`。使用技能自带脚本，不另写 API 调用程序。提示词文本已保存在 `output/imagegen/starsea-v2/prompts/`；以下命令只有在密钥与运行环境就绪后才执行，会调用付费图像 API：

```powershell
$imageGenScript = 'C:\Users\ASUS\.codex\skills\.system\imagegen\scripts\image_gen.py'
$env:OPENAI_API_KEY = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'User')
python $imageGenScript generate --model gpt-image-2 --prompt-file output/imagegen/starsea-v2/prompts/starsea-01.txt --size 2048x1152 --quality high --output-format webp --output-compression 90 --out output/imagegen/starsea-v2/starsea-01.webp
python $imageGenScript edit --model gpt-image-2 --image output/imagegen/starsea-v2/starsea-01.webp --prompt-file output/imagegen/starsea-v2/prompts/starsea-02.txt --size 2048x1152 --quality high --output-format webp --output-compression 90 --out output/imagegen/starsea-v2/starsea-02.webp
python $imageGenScript edit --model gpt-image-2 --image output/imagegen/starsea-v2/starsea-01.webp --prompt-file output/imagegen/starsea-v2/prompts/starsea-03.txt --size 2048x1152 --quality high --output-format webp --output-compression 90 --out output/imagegen/starsea-v2/starsea-03.webp
python $imageGenScript edit --model gpt-image-2 --image output/imagegen/starsea-v2/starsea-01.webp --prompt-file output/imagegen/starsea-v2/prompts/starsea-04.txt --size 2048x1152 --quality high --output-format webp --output-compression 90 --out output/imagegen/starsea-v2/starsea-04.webp
```

逐张检查实际输出、手机中央裁剪和相邻帧一致性后，才复制到接入目录并创建清单。不要把提示词、空文件或测试用像素图片写成生成成功的素材。
