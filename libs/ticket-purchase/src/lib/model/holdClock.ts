export type HoldClockPhase = 'normal' | 'warning' | 'critical' | 'expired';

export type HoldClockReading = Readonly<{
  secondsRemaining: number;
  phase: HoldClockPhase;
}>;

/** Calculate a hold countdown against the server timestamp captured with that hold. */
export function readHoldClock(
  expiresAt: string,
  serverOffsetMs: number,
  clientNow = Date.now(),
  warningSeconds = 120,
  criticalSeconds = 30,
): HoldClockReading {
  const secondsRemaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - (clientNow + serverOffsetMs)) / 1_000));
  const phase: HoldClockPhase = secondsRemaining === 0
    ? 'expired'
    : secondsRemaining <= criticalSeconds
      ? 'critical'
      : secondsRemaining <= warningSeconds
        ? 'warning'
        : 'normal';
  return { secondsRemaining, phase };
}
