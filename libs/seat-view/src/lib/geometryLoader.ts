import type { BuyerGeometryChunk, BuyerGeometryManifest } from '@hall-platform/api-contracts';
import type { SpatialBounds } from '@hall-platform/geometry';
import { GeometryByteCache } from './geometryCache.js';

export type BuyerGeometrySource = Readonly<{
  getManifest: (occurrenceId: string, signal?: AbortSignal) => Promise<BuyerGeometryManifest>;
  getBlock: (manifest: BuyerGeometryManifest, blockId: string, signal?: AbortSignal) => Promise<BuyerGeometryChunk>;
}>;

export type GeometryViewportResult = Readonly<{
  manifest: BuyerGeometryManifest;
  overview: BuyerGeometryManifest['overview'];
  blocks: readonly BuyerGeometryChunk[];
  prefetch: Promise<void>;
}>;

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

class Semaphore {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Geometry concurrency must be a positive integer');
  }

  async run<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal);
    try {
      if (signal?.aborted) throw abortError();
      return await operation();
    } finally {
      release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(abortError());
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (!next) {
      this.active -= 1;
      return;
    }
    if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
    next.resolve(() => this.release());
  }
}

function abortError(): Error {
  const error = new Error('Geometry request cancelled');
  error.name = 'AbortError';
  return error;
}

function intersects(left: SpatialBounds, right: SpatialBounds): boolean {
  return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
}

function blockCacheKey(manifest: BuyerGeometryManifest, blockId: string): string {
  return `${manifest.occurrenceId}:${manifest.layoutVersionId}:${blockId}`;
}

function geometryIds(chunk: BuyerGeometryChunk): readonly string[] {
  return [
    ...chunk.rows.map(({ id }) => `row:${id}`),
    ...chunk.seats.map(({ id }) => `seat:${id}`),
    ...chunk.tables.map(({ id }) => `table:${id}`),
    ...chunk.decorations.map(({ id }) => `decoration:${id}`),
  ];
}

/** Loads overview-first immutable blocks with bounded concurrency and byte-LRU caching. */
export class BuyerGeometryLoader {
  private readonly cache: GeometryByteCache<BuyerGeometryChunk>;
  private readonly semaphore: Semaphore;
  private readonly entityOwners = new Map<string, string>();
  private ownerContext = '';

  constructor(
    private readonly source: BuyerGeometrySource,
    options: Readonly<{ maxCacheBytes?: number; maxConcurrency?: number }> = {},
  ) {
    this.cache = new GeometryByteCache(options.maxCacheBytes, (key, chunk) => this.unregisterOwners(key, chunk));
    this.semaphore = new Semaphore(options.maxConcurrency ?? 4);
  }

  async getManifest(occurrenceId: string, signal?: AbortSignal): Promise<BuyerGeometryManifest> {
    const manifest = await this.source.getManifest(occurrenceId, signal);
    if (manifest.occurrenceId !== occurrenceId) throw new Error('Geometry manifest belongs to another occurrence');
    this.setOwnerContext(manifest);
    return manifest;
  }

  async loadBlocks(
    manifest: BuyerGeometryManifest,
    blockIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly BuyerGeometryChunk[]> {
    this.setOwnerContext(manifest);
    const uniqueIds = [...new Set(blockIds)];
    const refs = uniqueIds.map((id) => {
      const ref = manifest.blocks.find((candidate) => candidate.id === id);
      if (!ref) throw new Error(`Geometry block ${id} is missing from the manifest`);
      return ref;
    });
    return Promise.all(refs.map((ref) => this.semaphore.run(signal, async () => {
      const key = blockCacheKey(manifest, ref.id);
      const cached = this.cache.get(key);
      if (cached) {
        this.registerOwners(key, cached);
        return cached;
      }
      const chunk = await this.source.getBlock(manifest, ref.id, signal);
      if (chunk.occurrenceId !== manifest.occurrenceId || chunk.layoutVersionId !== manifest.layoutVersionId ||
          chunk.blockId !== ref.id || chunk.floorId !== ref.floorId) {
        throw new Error('Geometry block identity does not match its manifest');
      }
      this.validateOwners(key, chunk);
      if (this.cache.set(key, chunk, ref.asset.byteLength)) this.registerOwners(key, chunk);
      return chunk;
    })));
  }

  async loadViewport(
    manifest: BuyerGeometryManifest,
    viewport: SpatialBounds,
    signal?: AbortSignal,
  ): Promise<GeometryViewportResult> {
    const visibleRefs = manifest.blocks.filter((block) => intersects(block.bounds, viewport));
    const width = Math.max(1, viewport.maxX - viewport.minX);
    const height = Math.max(1, viewport.maxY - viewport.minY);
    const expanded = {
      minX: viewport.minX - width * 0.35,
      minY: viewport.minY - height * 0.35,
      maxX: viewport.maxX + width * 0.35,
      maxY: viewport.maxY + height * 0.35,
    };
    const visibleIds = new Set(visibleRefs.map(({ id }) => id));
    const prefetchIds = manifest.blocks.filter((block) => !visibleIds.has(block.id) && intersects(block.bounds, expanded)).map(({ id }) => id);
    const blocksPromise = this.loadBlocks(manifest, visibleRefs.map(({ id }) => id), signal);
    const prefetch = this.loadBlocks(manifest, prefetchIds, signal).then(() => undefined).catch(() => undefined);
    return {
      manifest,
      overview: manifest.overview,
      blocks: await blocksPromise,
      prefetch,
    };
  }

  dispose(): void {
    this.cache.clear();
    this.entityOwners.clear();
    this.ownerContext = '';
  }

  private setOwnerContext(manifest: BuyerGeometryManifest): void {
    const context = `${manifest.occurrenceId}:${manifest.layoutVersionId}`;
    if (this.ownerContext === context) return;
    this.entityOwners.clear();
    this.ownerContext = context;
  }

  private validateOwners(key: string, chunk: BuyerGeometryChunk): void {
    for (const entityId of geometryIds(chunk)) {
      const previousOwner = this.entityOwners.get(entityId);
      if (previousOwner && previousOwner !== key) throw new Error(`Geometry entity ${entityId} belongs to multiple blocks`);
    }
  }

  private registerOwners(key: string, chunk: BuyerGeometryChunk): void {
    this.validateOwners(key, chunk);
    for (const entityId of geometryIds(chunk)) this.entityOwners.set(entityId, key);
  }

  private unregisterOwners(key: string, chunk: BuyerGeometryChunk): void {
    for (const entityId of geometryIds(chunk)) {
      if (this.entityOwners.get(entityId) === key) this.entityOwners.delete(entityId);
    }
  }
}
