import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  CameraController,
  type CameraUpdate,
  type CameraSnapshot,
  type Viewport,
} from '@hall-platform/renderer-core';

export function useViewportController(
  initialViewport: Viewport,
  sharedController?: CameraController,
) {
  const [ownedController] = useState(
    () =>
      new CameraController(
        initialViewport,
        (callback) => requestAnimationFrame(callback),
        (frame) => cancelAnimationFrame(frame),
      ),
  );
  const controller = sharedController ?? ownedController;
  useEffect(() => {
    if (sharedController?.getSnapshot().revision === 0)
      sharedController.update(initialViewport);
  }, [sharedController, initialViewport]);
  const viewport = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const getViewport = useCallback(
    (): CameraSnapshot => controller.peek(),
    [controller],
  );
  const setViewport = useCallback(
    (update: CameraUpdate) => controller.update(update),
    [controller],
  );

  return { cameraController: controller, viewport, getViewport, setViewport };
}
