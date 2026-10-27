export type CanvasPixelSize = Readonly<{
  width: number;
  height: number;
  pixelRatio: number;
}>;

const maximumPixelCount = 16_777_216;

export function canvasPixelSize(
  cssWidth: number,
  cssHeight: number,
  requestedPixelRatio: number,
): CanvasPixelSize {
  const width = Math.max(1, Math.round(cssWidth));
  const height = Math.max(1, Math.round(cssHeight));
  const requested = Number.isFinite(requestedPixelRatio)
    ? Math.max(1, requestedPixelRatio)
    : 1;
  const pixelLimitRatio = Math.sqrt(maximumPixelCount / (width * height));
  const pixelRatio = Math.min(2, requested, pixelLimitRatio);
  return {
    width: Math.max(1, Math.round(width * pixelRatio)),
    height: Math.max(1, Math.round(height * pixelRatio)),
    pixelRatio,
  };
}
