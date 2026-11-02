type CacheEntry<T> = Readonly<{ value: T; byteLength: number }>;

/** Byte-bounded LRU for immutable geometry blocks. */
export class GeometryByteCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private bytes = 0;

  constructor(
    readonly maxBytes = 32 * 1024 * 1024,
    private readonly onDelete?: (key: string, value: T) => void,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('Geometry cache size must be a positive safe integer');
  }

  get byteLength(): number { return this.bytes; }
  get size(): number { return this.entries.size; }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, byteLength: number): boolean {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw new RangeError('Geometry block size must be a positive safe integer');
    this.delete(key);
    if (byteLength > this.maxBytes) return false;
    this.entries.set(key, { value, byteLength });
    this.bytes += byteLength;
    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    return this.entries.has(key);
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.bytes -= entry.byteLength;
    const deleted = this.entries.delete(key);
    if (deleted) this.onDelete?.(key, entry.value);
    return deleted;
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.onDelete?.(key, entry.value);
    this.entries.clear();
    this.bytes = 0;
  }
}
