# esaygit 品牌图片

使用 Codex 内置 imagegen 生成，2026-10-20。应用名称的拼写为 **esaygit**。

- `public/brand/esaygit-icon.png`：1254 × 1254，RGBA；黑底银白折带图标，圆角外透明。
- `public/brand/esaygit-wordmark.png`：2041 × 771，RGBA；透明底石墨色艺术字。
- `src-tauri/icons/icon.png` 和 `icon.ico`：使用 Tauri CLI 从上述图标导出。

标题栏直接显示艺术字图片，深色主题通过 CSS 反相适配。侧栏、启动页、设置页和错误页使用新图标。原有 `public/mark.svg` 保留，界面已不再引用。

## 图标提示词

参考用户提供的黑底银白折纸图片，`transparent_background: true`。

```text
Create a finished desktop application icon for a Git client named esaygit. Use the attached image solely as a material and lighting style reference. A square black rounded app tile with softly curved corners, carrying one memorable sculptural white-silver folded ribbon emblem. The emblem subtly forms a lowercase e, with a single clean split-and-rejoin fold suggesting Git branching and merging. Premium matte paper / satin ceramic material, restrained realistic depth, soft studio highlights, slight soft shadows, front three-quarter view close to frontal. Bold coherent silhouette, strong readability at 32 pixels. Centered emblem occupies approximately 70 percent of tile. Near-black tile fills the canvas apart from truly transparent outside corner pixels. No text, no lettering, no clock, no checkmark, no literal circuit dots, no generic knot, no neon, no colored gradients. Beautiful precise origami-like folds, minimalist monochrome. Deliver one square production app icon PNG.
```

## 艺术字提示词

参考上一张生成的图标，`transparent_background: true`。

```text
Create a production typography wordmark PNG for the desktop Git app esaygit. The ONLY text must be exactly "esaygit" in lowercase, spelled e s a y g i t, all seven letters clearly readable. A custom drawn artistic logotype, confident slightly forward-leaning rounded geometric lettering with clever ribbon-cut joins and subtle folded terminals. Sophisticated contemporary software identity, beautifully balanced optical spacing. Dark graphite-black lettering with very restrained satin dimensional bevels, using the attached silver origami icon as material inspiration but adapted for a LIGHT application titlebar. Mostly solid dark strokes to remain sharp at 140 pixels wide. Keep the letters connected into a coherent compact word silhouette, do not put icon alongside it. Wide horizontal composition, wordmark fills nearly the whole width, minimal transparent padding, no large whitespace, small depth and no long cast shadows. Real transparent alpha background. No background tile, no checkerboard drawn into image, no subtitle, no tagline, no extra symbols, no decorative swooshes around the word. Show the exact word once. Deliver a tightly framed horizontal brand asset, not a presentation mockup.
```
