# easygit 品牌图片

应用名称统一拼写为 **easygit**（e a s y g i t）。

- `public/brand/easygit-wordmark.png`：2026-10-21 使用内置 imagegen，参考原字标重新生成的透明底石墨色折带艺术字；用于标题栏和启动页。
- `public/brand/esaygit-icon.png`：原有黑底银白折带应用图标，图片内容、侧栏样式及引用路径均保持原样。
- `src-tauri/icons/icon.png` 和 `icon.ico`：保持原桌面应用图标。

深色主题沿用 CSS 反相适配字标。应用标识符与已有本地设置键保持原值，保留原有主题、最近仓库及面板布局。

## 顶部字标生成提示词

模式：内置 imagegen；透明背景；参考图 `public/brand/esaygit-wordmark.png`。

```text
Use case: logo-brand. Recreate the attached existing desktop Git client titlebar wordmark in the same sophisticated dark graphite folded-ribbon lettering style, but CORRECT THE NAME. The exact and only text must be "easygit", spelled e a s y g i t (seven lowercase letters in that order). This is a new finished replacement wordmark image for the TOP LEFT TITLEBAR, NOT an application icon. Use the attached image as the typography/material reference: custom rounded geometric slightly forward-leaning ribbon-like letters, restrained satin folds and subtle silver highlights, predominantly solid near-black graphite strokes for excellent readability at 116 pixels wide. Improve optical spacing and keep all seven letters clearly legible. Make the first four letters exactly e-a-s-y, then g-i-t. Keep the entire word on a single baseline, wide compact horizontal composition with minimal transparent margin. No separate icon, no emblem, no black tile, no slogan, no additional words, no mockup, no shadow extending far outside the letters, no checkerboard drawn into the image. Real fully transparent alpha background. Front-facing artwork, crisp clean edges. Preserve the overall character of the reference while presenting a precise attractive easygit wordmark for a light gray software titlebar. Deliver a tightly framed wide horizontal PNG.
```
