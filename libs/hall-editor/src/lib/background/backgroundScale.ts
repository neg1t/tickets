export type BackgroundPageSize = Readonly<{
  width: number;
  height: number;
}>;

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${label} must be a positive finite number`);
}

export function backgroundScalePercent(
  scale: number,
  referenceScale: number,
): number {
  assertPositiveFinite(scale, 'Scale');
  assertPositiveFinite(referenceScale, 'Reference scale');
  return (scale / referenceScale) * 100;
}

export function backgroundScaleFromPercent(
  referenceScale: number,
  percent: number,
): number {
  assertPositiveFinite(referenceScale, 'Reference scale');
  assertPositiveFinite(percent, 'Scale percentage');
  const scale = (referenceScale * percent) / 100;
  assertPositiveFinite(scale, 'Scale');
  return scale;
}

export function backgroundScaleForDistance(
  currentScale: number,
  measuredDistance: number,
  targetDistance: number,
): number {
  assertPositiveFinite(currentScale, 'Current scale');
  assertPositiveFinite(measuredDistance, 'Measured distance');
  assertPositiveFinite(targetDistance, 'Target distance');
  const result = currentScale * (targetDistance / measuredDistance);
  assertPositiveFinite(result, 'Scale');
  return result;
}

/** Adjusts the PDF's top-left origin so the visual center stays fixed. */
export function scaleBackgroundAroundCenter(
  position: Readonly<{ x: number; y: number }>,
  currentScale: number,
  nextScale: number,
  pageSize: BackgroundPageSize,
  rotationRadians: number,
): Readonly<{ x: number; y: number }> {
  assertPositiveFinite(currentScale, 'Current scale');
  assertPositiveFinite(nextScale, 'Next scale');
  assertPositiveFinite(pageSize.width, 'Page width');
  assertPositiveFinite(pageSize.height, 'Page height');
  if (![position.x, position.y, rotationRadians].every(Number.isFinite))
    throw new RangeError('Position and rotation must be finite numbers');

  const ratio = nextScale / currentScale;
  const centerX = (pageSize.width * currentScale) / 2;
  const centerY = (pageSize.height * currentScale) / 2;
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  const rotatedX = centerX * cosine - centerY * sine;
  const rotatedY = centerX * sine + centerY * cosine;
  const nextRotatedX = rotatedX * ratio;
  const nextRotatedY = rotatedY * ratio;

  return {
    x: position.x + rotatedX - nextRotatedX,
    y: position.y + rotatedY - nextRotatedY,
  };
}

export function fitBackgroundToPageSize(
  background: Readonly<{
    position: Readonly<{ x: number; y: number }>;
    scale: number;
    rotationRadians: number;
  }>,
  currentPage: BackgroundPageSize,
  nextPage: BackgroundPageSize,
): Readonly<{ scale: number; position: Readonly<{ x: number; y: number }> }> {
  assertPositiveFinite(background.scale, 'Current scale');
  assertPositiveFinite(currentPage.width, 'Current page width');
  assertPositiveFinite(currentPage.height, 'Current page height');
  assertPositiveFinite(nextPage.width, 'Next page width');
  assertPositiveFinite(nextPage.height, 'Next page height');
  const scale = (background.scale * currentPage.width) / nextPage.width;
  assertPositiveFinite(scale, 'Scale');
  const cosine = Math.cos(background.rotationRadians);
  const sine = Math.sin(background.rotationRadians);
  const oldCenterX = (currentPage.width * background.scale) / 2;
  const oldCenterY = (currentPage.height * background.scale) / 2;
  const centerX = background.position.x + oldCenterX * cosine - oldCenterY * sine;
  const centerY = background.position.y + oldCenterX * sine + oldCenterY * cosine;
  const nextCenterX = (nextPage.width * scale) / 2;
  const nextCenterY = (nextPage.height * scale) / 2;
  return {
    scale,
    position: {
      x: centerX - (nextCenterX * cosine - nextCenterY * sine),
      y: centerY - (nextCenterX * sine + nextCenterY * cosine),
    },
  };
}
