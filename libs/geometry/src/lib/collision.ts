import type { LineSegment } from './line.js';
import { createRotationMatrix, transformVector } from './matrix.js';
import {
  distanceToPolygonBoundary,
  isPointInPolygon,
  polygonBounds,
  type Polygon,
} from './polygon.js';
import {
  addVectors,
  crossVectors,
  distanceBetweenVectors,
  subtractVectors,
  type Vector2,
} from './vector.js';

export type CollisionCircle = {
  readonly center: Vector2;
  readonly radius: number;
};

export type OrientedRectangle = {
  readonly center: Vector2;
  readonly width: number;
  readonly height: number;
  readonly rotationRadians: number;
};

export type CollisionShape =
  | ({ readonly kind: 'circle' } & CollisionCircle)
  | { readonly kind: 'polygon'; readonly vertices: Polygon }
  | ({ readonly kind: 'rectangle' } & OrientedRectangle);

function orientation(start: Vector2, end: Vector2, point: Vector2): number {
  return crossVectors(
    subtractVectors(end, start),
    subtractVectors(point, start),
  );
}

function pointOnSegment(segment: LineSegment, point: Vector2): boolean {
  return (
    orientation(segment.start, segment.end, point) === 0 &&
    point.x >= Math.min(segment.start.x, segment.end.x) &&
    point.x <= Math.max(segment.start.x, segment.end.x) &&
    point.y >= Math.min(segment.start.y, segment.end.y) &&
    point.y <= Math.max(segment.start.y, segment.end.y)
  );
}

function oppositeSigns(first: number, second: number): boolean {
  return (first < 0 && second > 0) || (first > 0 && second < 0);
}

// Shared endpoints and collinear overlap count as an intersection.
export function segmentsIntersect(
  first: LineSegment,
  second: LineSegment,
): boolean {
  const firstStart = orientation(first.start, first.end, second.start);
  const firstEnd = orientation(first.start, first.end, second.end);
  const secondStart = orientation(second.start, second.end, first.start);
  const secondEnd = orientation(second.start, second.end, first.end);

  if (firstStart === 0 && pointOnSegment(first, second.start)) return true;
  if (firstEnd === 0 && pointOnSegment(first, second.end)) return true;
  if (secondStart === 0 && pointOnSegment(second, first.start)) return true;
  if (secondEnd === 0 && pointOnSegment(second, first.end)) return true;

  return (
    oppositeSigns(firstStart, firstEnd) && oppositeSigns(secondStart, secondEnd)
  );
}

function requireCircle(circle: CollisionCircle): void {
  if (
    !Number.isFinite(circle.center.x) ||
    !Number.isFinite(circle.center.y) ||
    !Number.isFinite(circle.radius) ||
    circle.radius < 0
  ) {
    throw new RangeError('Circle center and radius must be finite and valid');
  }
}

export function circlesIntersect(
  first: CollisionCircle,
  second: CollisionCircle,
): boolean {
  requireCircle(first);
  requireCircle(second);
  return (
    distanceBetweenVectors(first.center, second.center) <=
    first.radius + second.radius
  );
}

export function circleIntersectsPolygon(
  circle: CollisionCircle,
  polygon: Polygon,
): boolean {
  requireCircle(circle);
  if (polygon.length === 0) return false;
  if (isPointInPolygon(polygon, circle.center)) return true;
  const distance = distanceToPolygonBoundary(polygon, circle.center);
  return distance !== null && distance <= circle.radius;
}

function polygonEdges(polygon: Polygon): LineSegment[] {
  return polygon.flatMap((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return end === undefined ? [] : [{ start, end }];
  });
}

export function polygonsIntersect(first: Polygon, second: Polygon): boolean {
  const firstBounds = polygonBounds(first);
  const secondBounds = polygonBounds(second);
  if (firstBounds === null || secondBounds === null) return false;
  if (
    firstBounds.maxX < secondBounds.minX ||
    secondBounds.maxX < firstBounds.minX ||
    firstBounds.maxY < secondBounds.minY ||
    secondBounds.maxY < firstBounds.minY
  ) {
    return false;
  }

  const secondEdges = polygonEdges(second);
  for (const firstEdge of polygonEdges(first)) {
    if (
      secondEdges.some((secondEdge) => segmentsIntersect(firstEdge, secondEdge))
    ) {
      return true;
    }
  }
  const firstVertex = first[0];
  const secondVertex = second[0];
  return (
    (firstVertex !== undefined && isPointInPolygon(second, firstVertex)) ||
    (secondVertex !== undefined && isPointInPolygon(first, secondVertex))
  );
}

export function createRectanglePolygon(rectangle: OrientedRectangle): Polygon {
  if (
    !Number.isFinite(rectangle.center.x) ||
    !Number.isFinite(rectangle.center.y) ||
    !Number.isFinite(rectangle.rotationRadians) ||
    !Number.isFinite(rectangle.width) ||
    !Number.isFinite(rectangle.height) ||
    rectangle.width <= 0 ||
    rectangle.height <= 0
  ) {
    throw new RangeError('Rectangle geometry must be finite and positive');
  }

  const halfWidth = rectangle.width / 2;
  const halfHeight = rectangle.height / 2;
  const rotation = createRotationMatrix(rectangle.rotationRadians);
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((corner) =>
    addVectors(rectangle.center, transformVector(rotation, corner)),
  );
}

function shapePolygon(
  shape: Exclude<CollisionShape, { kind: 'circle' }>,
): Polygon {
  return shape.kind === 'polygon'
    ? shape.vertices
    : createRectanglePolygon(shape);
}

export function shapesIntersect(
  first: CollisionShape,
  second: CollisionShape,
): boolean {
  if (first.kind === 'circle') {
    return second.kind === 'circle'
      ? circlesIntersect(first, second)
      : circleIntersectsPolygon(first, shapePolygon(second));
  }
  if (second.kind === 'circle') {
    return circleIntersectsPolygon(second, shapePolygon(first));
  }
  return polygonsIntersect(shapePolygon(first), shapePolygon(second));
}
