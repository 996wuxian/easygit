import { describe, expect, it } from 'vitest';
import { imageSizeLabel, svgPreviewUrl } from './imagePreview';

describe('SVG 图片数据', () => {
  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><text>中文 🎉 &amp; # + %</text></svg>',
    `<svg><!--${'图'.repeat(40000)}--></svg>`,
  ])('完整保留 Unicode 和较大 SVG 的 UTF-8 内容', content => {
    const url = svgPreviewUrl(content);
    const bytes = Uint8Array.from(atob(url.split(',')[1]), char => char.charCodeAt(0));
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(new TextDecoder().decode(bytes)).toBe(content);
  });

  it('输入未配对代理字符时不使预览崩溃', () => {
    expect(() => svgPreviewUrl('<svg>\ud800</svg>')).not.toThrow();
  });

  it.each([[1024, '1.0 KiB'], [1048576, '1.0 MiB']])('显示图片大小 %s', (size, label) => {
    expect(imageSizeLabel(size)).toBe(label);
  });
});
