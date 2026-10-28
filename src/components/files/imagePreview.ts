export function isImageFile(path: string): boolean {
  return /\.(?:png|jpe?g|jfif|gif|webp|bmp|ico|avif|svg)$/i.test(path);
}

export function svgPreviewUrl(content: string): string {
  const bytes = new TextEncoder().encode(content);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return `data:image/svg+xml;base64,${btoa(chunks.join(''))}`;
}

export function imageSizeLabel(size: number): string {
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}
