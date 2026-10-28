import type { Page, TestInfo } from '@playwright/test';
import { arch, cpus, platform, release, totalmem } from 'node:os';

export function percentile(
  values: readonly number[],
  fraction: number,
): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export type GpuClassification =
  'hardware' | 'software' | 'unknown' | 'not-used';

export function classifyGpu(
  webglUsed: boolean,
  vendor: string | null | undefined,
  renderer: string | null | undefined,
): GpuClassification {
  if (!webglUsed) return 'not-used';
  if (!vendor && !renderer) return 'unknown';
  return /swiftshader|llvmpipe|software|warp/i.test(
    `${vendor ?? ''} ${renderer ?? ''}`,
  )
    ? 'software'
    : 'hardware';
}

export type GestureMetrics = Readonly<{
  durationMs: number;
  frameIntervalsMs: readonly number[];
  inputToStateFeedbackMs: number | null;
  longTasks: readonly { startTime: number; duration: number }[];
}>;

export async function installPerformanceObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const metrics: {
      longTasks: { startTime: number; duration: number }[];
      pendingWebglVisibleSeats: number;
      webglVisibleSeatCount: number;
      gesture?: {
        active: boolean;
        startedAt: number;
        endedAt: number | null;
        previousFrame: number | null;
        frameIntervalsMs: number[];
        pointerStartedAt: number | null;
        inputToStateFeedbackMs: number | null;
        longTaskStartIndex: number;
        frame: number;
        targetSelector: string;
        feedbackAttribute: string;
        initialAttributeValue: string | null;
      };
    } = {
      longTasks: [],
      pendingWebglVisibleSeats: 0,
      webglVisibleSeatCount: 0,
    };
    Object.defineProperty(window, '__hallPerformanceMetrics', {
      value: metrics,
      configurable: false,
    });

    const observer = window.PerformanceObserver;
    if (observer && observer.supportedEntryTypes?.includes('longtask')) {
      new observer((list) => {
        for (const entry of list.getEntries())
          metrics.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
      }).observe({ type: 'longtask', buffered: true });
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const prototype = WebGL2RenderingContext.prototype;
      const drawArraysInstanced = prototype.drawArraysInstanced;
      prototype.drawArraysInstanced = function (
        mode: number,
        first: number,
        vertexCount: number,
        instanceCount: number,
      ) {
        metrics.pendingWebglVisibleSeats += instanceCount;
        drawArraysInstanced.call(this, mode, first, vertexCount, instanceCount);
      };
    }
    const publishWebglVisibleSeats = () => {
      metrics.webglVisibleSeatCount = Math.max(
        metrics.webglVisibleSeatCount,
        metrics.pendingWebglVisibleSeats,
      );
      metrics.pendingWebglVisibleSeats = 0;
      requestAnimationFrame(publishWebglVisibleSeats);
    };
    requestAnimationFrame(publishWebglVisibleSeats);
  });
}

export async function waitForPaint(page: Page, frameCount = 2): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const next = () => {
          if (count <= 0) resolve();
          else {
            count -= 1;
            requestAnimationFrame(next);
          }
        };
        requestAnimationFrame(next);
      }),
    frameCount,
  );
}

export async function beginGestureMetrics(
  page: Page,
  targetSelector = '.hall-viewer-canvas',
  feedbackAttribute = 'data-viewport-x',
): Promise<void> {
  return page.evaluate(
    ({ selector, attribute }) => {
      const windowWithMetrics = window as Window & {
        __hallPerformanceMetrics?: {
          longTasks: { startTime: number; duration: number }[];
          gesture?: {
            active: boolean;
            startedAt: number;
            endedAt: number | null;
            previousFrame: number | null;
            frameIntervalsMs: number[];
            pointerStartedAt: number | null;
            inputToStateFeedbackMs: number | null;
            longTaskStartIndex: number;
            frame: number;
            targetSelector: string;
            feedbackAttribute: string;
            initialAttributeValue: string | null;
          };
        };
      };
      const metrics = windowWithMetrics.__hallPerformanceMetrics;
      if (!metrics) throw new Error('Performance observer is not installed');
      if (metrics.gesture?.active)
        throw new Error('A gesture measurement is already active');
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) throw new Error(`Missing gesture target: ${selector}`);
      const gesture: NonNullable<typeof metrics.gesture> = {
        active: false,
        startedAt: performance.now(),
        endedAt: null,
        previousFrame: null,
        frameIntervalsMs: [],
        pointerStartedAt: null,
        inputToStateFeedbackMs: null,
        longTaskStartIndex: metrics.longTasks.length,
        frame: 0,
        targetSelector: selector,
        feedbackAttribute: attribute,
        initialAttributeValue: target.getAttribute(attribute),
      };
      metrics.gesture = gesture;
      const pointerDown = (event: PointerEvent) => {
        if (
          event.target instanceof Element &&
          event.target.closest(selector) === target
        ) {
          const now = performance.now();
          gesture.active = true;
          gesture.startedAt = now;
          gesture.pointerStartedAt = now;
          gesture.previousFrame = null;
          gesture.frameIntervalsMs.length = 0;
          gesture.longTaskStartIndex = metrics.longTasks.length;
          gesture.initialAttributeValue = target.getAttribute(attribute);
          gesture.frame = requestAnimationFrame(frame);
        }
      };
      const pointerEnd = (event: PointerEvent) => {
        if (
          event.target instanceof Element &&
          event.target.closest(selector) === target &&
          gesture.pointerStartedAt !== null
        ) {
          gesture.endedAt = performance.now();
          gesture.active = false;
          cancelAnimationFrame(gesture.frame);
        }
      };
      document.addEventListener('pointerdown', pointerDown, true);
      document.addEventListener('pointerup', pointerEnd, true);
      document.addEventListener('pointercancel', pointerEnd, true);
      const observer = new MutationObserver(() => {
        const nextValue = target.getAttribute(attribute);
        if (
          gesture.pointerStartedAt !== null &&
          gesture.inputToStateFeedbackMs === null &&
          nextValue !== gesture.initialAttributeValue
        ) {
          gesture.inputToStateFeedbackMs =
            performance.now() - gesture.pointerStartedAt;
        }
      });
      observer.observe(target, {
        attributes: true,
        attributeFilter: [attribute],
      });
      const frame = (now: number) => {
        if (!gesture.active || gesture.pointerStartedAt === null) return;
        if (gesture.previousFrame !== null)
          gesture.frameIntervalsMs.push(now - gesture.previousFrame);
        gesture.previousFrame = now;
        gesture.frame = requestAnimationFrame(frame);
      };
      Object.assign(gesture, {
        cleanup: () => {
          document.removeEventListener('pointerdown', pointerDown, true);
          document.removeEventListener('pointerup', pointerEnd, true);
          document.removeEventListener('pointercancel', pointerEnd, true);
          observer.disconnect();
        },
      });
    },
    { selector: targetSelector, attribute: feedbackAttribute },
  );
}

export async function endGestureMetrics(page: Page): Promise<GestureMetrics> {
  return page.evaluate(() => {
    const windowWithMetrics = window as Window & {
      __hallPerformanceMetrics?: {
        longTasks: { startTime: number; duration: number }[];
        gesture?: {
          active: boolean;
          startedAt: number;
          endedAt: number | null;
          pointerStartedAt: number | null;
          frameIntervalsMs: number[];
          inputToStateFeedbackMs: number | null;
          longTaskStartIndex: number;
          cleanup?: () => void;
        };
      };
    };
    const metrics = windowWithMetrics.__hallPerformanceMetrics;
    const gesture = metrics?.gesture;
    if (!metrics || !gesture)
      throw new Error('No gesture measurement is active');
    if (gesture.pointerStartedAt === null)
      throw new Error('The measured gesture never received pointer input');
    if (gesture.active) {
      gesture.endedAt = performance.now();
      gesture.active = false;
    }
    gesture.cleanup?.();
    const endTime = gesture.endedAt ?? performance.now();
    return {
      durationMs: endTime - gesture.startedAt,
      frameIntervalsMs: [...gesture.frameIntervalsMs],
      inputToStateFeedbackMs: gesture.inputToStateFeedbackMs,
      longTasks: metrics.longTasks
        .slice(gesture.longTaskStartIndex)
        .filter(({ startTime }) => startTime <= endTime),
    };
  });
}

export async function collectBrowserMetrics(page: Page) {
  const browser = await page.evaluate(() => {
    const performanceWithMemory = performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    };
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType(
      'resource',
    ) as PerformanceResourceTiming[];
    const memory = performanceWithMemory.memory;
    const performanceMetrics = (
      window as Window & {
        __hallPerformanceMetrics?: {
          longTasks: { startTime: number; duration: number }[];
          webglVisibleSeatCount: number;
        };
      }
    ).__hallPerformanceMetrics;
    const viewer = document.querySelector<HTMLElement>('.hall-viewer-canvas');
    const renderer = viewer?.dataset.seatRendererEngine ?? null;
    const webglVisibleSeatCount =
      performanceMetrics?.webglVisibleSeatCount ?? null;
    const webglCanvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    const gl = webglCanvas?.getContext('webgl2');
    const rendererInfoExtension = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpu =
      rendererInfoExtension && gl
        ? {
            vendor: gl.getParameter(
              rendererInfoExtension.UNMASKED_VENDOR_WEBGL,
            ),
            renderer: gl.getParameter(
              rendererInfoExtension.UNMASKED_RENDERER_WEBGL,
            ),
          }
        : null;
    const longTasks = performanceMetrics?.longTasks ?? [];
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio,
      renderer,
      activeSeatCount: Number(viewer?.dataset.floorSeatCount ?? 0),
      visibleSeatCount:
        renderer === 'webgl'
          ? (webglVisibleSeatCount ?? 0)
          : Number(viewer?.dataset.visibleSeatCount ?? 0),
      visibleSeatCountSource:
        renderer === 'webgl'
          ? 'maximum WebGL draw instances observed in a frame'
          : 'visible Konva scene seats',
      webglVisibleSeatCount,
      renderNodes: Number(viewer?.dataset.seatRenderNodes ?? 0),
      layoutVersionId: viewer?.dataset.layoutVersionId ?? null,
      sceneRevision: Number(viewer?.dataset.sceneRevision ?? 0),
      cameraRevision: Number(viewer?.dataset.cameraRevision ?? 0),
      gpu: { used: Boolean(webglCanvas), ...gpu },
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number })
        .deviceMemory,
      documentReadyState: document.readyState,
      navigation: navigation
        ? {
            domContentLoadedMs:
              navigation.domContentLoadedEventEnd - navigation.startTime,
            loadEventMs: navigation.loadEventEnd - navigation.startTime,
            responseMs: navigation.responseEnd - navigation.requestStart,
          }
        : null,
      resources: {
        count: resources.length,
        transferBytes: resources.reduce(
          (total, entry) => total + entry.transferSize,
          0,
        ),
        decodedBytes: resources.reduce(
          (total, entry) => total + entry.decodedBodySize,
          0,
        ),
      },
      marks: performance
        .getEntriesByType('mark')
        .map(({ name, startTime }) => ({ name, startTime })),
      measures: performance
        .getEntriesByType('measure')
        .map(({ name, startTime, duration }) => ({
          name,
          startTime,
          duration,
        })),
      longTasks: (() => {
        const durations = longTasks
          .map(({ duration }) => duration)
          .sort((left, right) => left - right);
        const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
        return {
          count: durations.length,
          over200ms: durations.filter((duration) => duration > 200).length,
          totalDurationMs: durations.reduce(
            (total, duration) => total + duration,
            0,
          ),
          p95DurationMs: durations[p95Index] ?? 0,
          maxDurationMs: durations.at(-1) ?? 0,
          longestSamplesMs: durations.slice(-8).reverse(),
        };
      })(),
      heapBytes: memory?.usedJSHeapSize ?? null,
      heapLimitBytes: memory?.totalJSHeapSize ?? null,
    };
  });

  return {
    capturedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      osRelease: release(),
      architecture: arch(),
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    browser: {
      ...browser,
      gpu: {
        classification: classifyGpu(
          browser.gpu.used,
          browser.gpu.vendor,
          browser.gpu.renderer,
        ),
        ...(browser.gpu.vendor ? { vendor: browser.gpu.vendor } : {}),
        ...(browser.gpu.renderer ? { renderer: browser.gpu.renderer } : {}),
      },
    },
  };
}

export async function attachPerformanceReport(
  page: Page,
  testInfo: TestInfo,
  name: string,
  scenario: Record<string, unknown>,
): Promise<void> {
  const report = {
    ...scenario,
    testProject: testInfo.project.name,
    networkProfile: 'localhost without throttling',
    thermalState: 'not measured by Playwright',
    buildRevision: process.env['GIT_SHA'] ?? null,
    buildId: process.env['GITHUB_SHA'] ?? process.env['GIT_SHA'] ?? null,
    ...(await collectBrowserMetrics(page)),
  };
  const body = JSON.stringify(report, null, 2);
  await testInfo.attach(name, { body, contentType: 'application/json' });
  console.log(body);
}
