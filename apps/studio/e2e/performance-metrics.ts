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

export async function installPerformanceObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const metrics: { longTasks: { startTime: number; duration: number }[] } = {
      longTasks: [],
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

export async function measureFrameIntervals(
  page: Page,
  frameCount = 180,
): Promise<number[]> {
  return page.evaluate(
    (count) =>
      new Promise<number[]>((resolve) => {
        const intervals: number[] = [];
        let previous = performance.now();
        const sample = (now: number) => {
          intervals.push(now - previous);
          previous = now;
          if (intervals.length >= count) resolve(intervals);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    frameCount,
  );
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
    const longTasks =
      (
        window as Window & {
          __hallPerformanceMetrics?: {
            longTasks: { startTime: number; duration: number }[];
          };
        }
      ).__hallPerformanceMetrics?.longTasks ?? [];
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
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
    browser,
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
    ...(await collectBrowserMetrics(page)),
  };
  const body = JSON.stringify(report, null, 2);
  await testInfo.attach(name, { body, contentType: 'application/json' });
  console.log(body);
}
