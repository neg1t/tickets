import { useEffect, useState } from 'react';

export function useCanvasHeight() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(500);

  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const next = Math.floor(element.clientHeight);
      if (next > 0) setHeight(Math.max(180, next - 110));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { setElement, height };
}
