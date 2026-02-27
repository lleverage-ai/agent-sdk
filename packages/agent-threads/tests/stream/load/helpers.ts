import { expect } from "vitest";

export interface PercentileReport {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
}

export class Stopwatch {
  private samples: number[] = [];

  start(): () => void {
    const t0 = performance.now();
    return () => {
      this.samples.push(performance.now() - t0);
    };
  }

  getReport(): PercentileReport {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const count = sorted.length;
    if (count === 0) {
      return { count: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 };
    }
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
      count,
      p50: sorted[Math.floor(count * 0.5)]!,
      p95: sorted[Math.floor(count * 0.95)]!,
      p99: sorted[Math.floor(count * 0.99)]!,
      min: sorted[0]!,
      max: sorted[count - 1]!,
      mean: sum / count,
    };
  }
}

export function assertSLO(
  report: PercentileReport,
  label: string,
  thresholds: { p50MaxMs?: number; p95MaxMs?: number; p99MaxMs?: number },
): void {
  if (thresholds.p50MaxMs !== undefined) {
    expect(report.p50, `${label} p50 (${report.p50.toFixed(2)}ms)`).toBeLessThan(
      thresholds.p50MaxMs,
    );
  }
  if (thresholds.p95MaxMs !== undefined) {
    expect(report.p95, `${label} p95 (${report.p95.toFixed(2)}ms)`).toBeLessThan(
      thresholds.p95MaxMs,
    );
  }
  if (thresholds.p99MaxMs !== undefined) {
    expect(report.p99, `${label} p99 (${report.p99.toFixed(2)}ms)`).toBeLessThan(
      thresholds.p99MaxMs,
    );
  }
}

export function generateTestEvents(count: number): Array<{ kind: string; value: number }> {
  const events: Array<{ kind: string; value: number }> = [];
  for (let i = 0; i < count; i++) {
    events.push({ kind: `event-${i % 10}`, value: i });
  }
  return events;
}
