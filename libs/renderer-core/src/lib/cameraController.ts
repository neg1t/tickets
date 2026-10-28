import type { CameraSnapshot, Viewport } from './viewport.js';

export type CameraFrameTarget = (snapshot: CameraSnapshot) => void;
export type CameraUpdate = Viewport | ((current: CameraSnapshot) => Viewport);

type RequestFrame = (callback: (time: number) => void) => number;
type CancelFrame = (frame: number) => void;

export class CameraController {
  private snapshot: CameraSnapshot;
  private pending: Viewport | null = null;
  private frame: number | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly targets = new Set<CameraFrameTarget>();

  constructor(
    initial: Viewport,
    private readonly requestFrame: RequestFrame,
    private readonly cancelFrame: CancelFrame,
  ) {
    this.snapshot = {
      x: initial.x,
      y: initial.y,
      scale: initial.scale,
      revision: initial.revision ?? 0,
    };
  }

  readonly getSnapshot = (): CameraSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  peek(): CameraSnapshot {
    if (!this.pending) return this.snapshot;
    return {
      x: this.pending.x,
      y: this.pending.y,
      scale: this.pending.scale,
      revision: this.snapshot.revision + 1,
    };
  }

  update(update: CameraUpdate): CameraSnapshot {
    const current = this.peek();
    this.pending = typeof update === 'function' ? update(current) : update;
    if (this.frame === null)
      this.frame = this.requestFrame(() => {
        this.frame = null;
        this.flush();
      });
    return this.peek();
  }

  flush(): CameraSnapshot {
    if (!this.pending) return this.snapshot;
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
    const next = this.pending;
    this.pending = null;
    this.snapshot = {
      x: next.x,
      y: next.y,
      scale: next.scale,
      revision: this.snapshot.revision + 1,
    };
    for (const target of this.targets) target(this.snapshot);
    for (const listener of this.listeners) listener();
    return this.snapshot;
  }

  attach(target: CameraFrameTarget): () => void {
    this.targets.add(target);
    target(this.snapshot);
    return () => this.targets.delete(target);
  }

  cancelPendingFrame(): void {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.pending = null;
  }
}
