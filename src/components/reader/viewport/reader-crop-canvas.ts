import { pdfjs } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { renderedInkCrop, paperColor } from "./reader-crop";
import { FULL_PAGE, type CropBox } from "./reader-geometry";

export async function canvasCrop(canvas: HTMLCanvasElement, page: PDFPageProxy, paperHex?: string | null): Promise<CropBox> {
  let sample: HTMLCanvasElement | undefined;
  try {
    const [annotations, operators] = await Promise.all([page.getAnnotations({ intent: "display" }), page.getOperatorList()]);
    const imageOps = [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintInlineImageXObjectGroup,
      pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageMaskXObjectGroup,
      pdfjs.OPS.paintImageMaskXObjectRepeat, pdfjs.OPS.paintSolidColorImageMask];
    const hasImages = operators.fnArray.some((op) => imageOps.includes(op));
    if (!canvas.width || !canvas.height || !canvas.isConnected) return FULL_PAGE;
    const viewport = page.getViewport({ scale: 1 });
    const boxes: CropBox[] = [];
    for (const annotation of annotations) {
      if (!Array.isArray(annotation.rect) || annotation.rect.length !== 4) return FULL_PAGE;
      const rect = [...viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]),
        ...viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3])];
      boxes.push({ x: Math.min(rect[0], rect[2]) / viewport.width, y: Math.min(rect[1], rect[3]) / viewport.height,
        width: Math.abs(rect[2] - rect[0]) / viewport.width, height: Math.abs(rect[3] - rect[1]) / viewport.height });
    }
    sample = document.createElement("canvas");
    const ratio = Math.min(256 / canvas.width, 256 / canvas.height, 1);
    sample.width = Math.max(1, Math.round(canvas.width * ratio)); sample.height = Math.max(1, Math.round(canvas.height * ratio));
    const context = sample.getContext("2d", { willReadFrequently: true });
    if (!context) return FULL_PAGE;
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    return renderedInkCrop(context.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height, boxes, hasImages, paperColor(paperHex));
  } catch { return FULL_PAGE; }
  finally { if (sample) { sample.width = 0; sample.height = 0; } }
}
