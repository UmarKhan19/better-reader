import { FULL_PAGE, type CropBox } from "./reader-geometry";

/** Conservative white-paper detection; dense images, blank and edge ink keep the full page. */
export function renderedInkCrop(pixels: Uint8ClampedArray, width: number, height: number, annotations: CropBox[] = [], hasImages = false): CropBox {
  if (hasImages || width < 8 || height < 8 || pixels.length !== width * height * 4) return FULL_PAGE;
  let left = width, right = 0, top = height, bottom = 0, ink = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (pixels[i + 3] > 32 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 232) {
      ink++;
      left = Math.min(left, x); right = Math.max(right, x + 1);
      top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
    }
  }
  if (ink < 8 || ink / (width * height) > 0.35 || left < width * 0.015 || top < height * 0.015 || right > width * 0.985 || bottom > height * 0.985) return FULL_PAGE;
  for (const box of annotations) {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return FULL_PAGE;
    left = Math.min(left, box.x * width); right = Math.max(right, (box.x + box.width) * width);
    top = Math.min(top, box.y * height); bottom = Math.max(bottom, (box.y + box.height) * height);
  }
  if ((right - left) * (bottom - top) / (width * height) < 0.08) return FULL_PAGE;
  // Padding protects antialiasing, punctuation and thin rules at the sampled boundary.
  const x = Math.max(0, left / width - 0.025), y = Math.max(0, top / height - 0.025);
  return { x, y, width: Math.min(1, right / width + 0.025) - x, height: Math.min(1, bottom / height + 0.025) - y };
}
