import { useCallback, useRef, useState } from 'react';
import type { Vector2 } from '@hall-platform/geometry';
import type { Viewport } from '../viewport.js';
import {
  advancePointerSession,
  beginPointerSession,
  type PointerSession,
} from './pointerSession.js';

export function usePointerInteraction() {
  const current = useRef<PointerSession | null>(null);
  const [preview, setPreview] = useState<PointerSession | null>(null);

  const begin = useCallback(
    (id: number, point: Vector2, viewport: Viewport) => {
      current.current = beginPointerSession(id, point, viewport);
      setPreview(null);
    },
    [],
  );

  const move = useCallback((id: number, point: Vector2, viewport: Viewport) => {
    const session = current.current;
    if (!session || session.pointerId !== id) return null;
    const next = advancePointerSession(session, point, viewport, id);
    current.current = next;
    setPreview(next.dragging ? next : null);
    return next;
  }, []);

  const finish = useCallback(
    (id: number, point: Vector2, viewport: Viewport) => {
      const session = current.current;
      if (!session || session.pointerId !== id) return null;
      const next = advancePointerSession(session, point, viewport, id);
      current.current = null;
      setPreview(null);
      return next;
    },
    [],
  );

  const cancel = useCallback((id?: number) => {
    if (id !== undefined && current.current?.pointerId !== id) return false;
    current.current = null;
    setPreview(null);
    return true;
  }, []);

  return { preview, begin, move, finish, cancel };
}
