import { useEffect, useRef, useState } from 'react';
import { readHoldClock } from '../model/holdClock.js';

const holdClockUrl = new URL('../../../assets/hold-clock.svg', import.meta.url).href;

export type HoldTimerProps = Readonly<{
  expiresAt: string;
  serverTime: string;
  locale: string;
  warningSeconds?: number;
  criticalSeconds?: number;
  onExpire?: () => void;
}>;

/** Isolated one-second countdown; it does not update the seat map or purchase controller. */
function HoldTimerInstance({
  expiresAt,
  serverTime,
  locale,
  warningSeconds = 120,
  criticalSeconds = 30,
  onExpire,
}: HoldTimerProps) {
  const holdKey = `${expiresAt}:${serverTime}`;
  const [localObservationTime] = useState(() => Date.now());
  const [clientNow, setClientNow] = useState(localObservationTime);
  const notifiedExpiry = useRef<string | null>(null);
  const serverOffsetMs = Date.parse(serverTime) - localObservationTime;
  const reading = readHoldClock(expiresAt, serverOffsetMs, clientNow, warningSeconds, criticalSeconds);
  const minutesLabel = String(Math.floor(reading.secondsRemaining / 60)).padStart(2, '0');
  const secondsLabel = String(reading.secondsRemaining % 60).padStart(2, '0');
  const english = locale.toLowerCase().startsWith('en');

  useEffect(() => {
    const update = () => setClientNow(Date.now());
    const timer = window.setInterval(update, 1_000);
    window.addEventListener('focus', update);
    window.addEventListener('pageshow', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('pageshow', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  useEffect(() => {
    if (reading.phase !== 'expired' || notifiedExpiry.current === holdKey) return;
    notifiedExpiry.current = holdKey;
    onExpire?.();
  }, [holdKey, onExpire, reading.phase]);

  return (
    <div
      className={`tp-hold-timer tp-hold-timer--${reading.phase}`}
      role="timer"
      aria-label={english
        ? `${minutesLabel}:${secondsLabel} left to complete purchase`
        : `Осталось ${minutesLabel}:${secondsLabel} на оформление покупки`}
    >
      <img src={holdClockUrl} width={26} height={26} alt="" aria-hidden="true" />
      <strong>{minutesLabel}:{secondsLabel}</strong>
    </div>
  );
}

export function HoldTimer(props: HoldTimerProps) {
  const key = `${props.expiresAt}:${props.serverTime}`;
  return <HoldTimerInstance key={key} {...props} />;
}
