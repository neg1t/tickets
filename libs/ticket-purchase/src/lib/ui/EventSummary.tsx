import { Button } from '@hall-platform/ui';
import type { BuyerOccurrenceSummary } from '@hall-platform/api-contracts';
import { getPurchaseMessages } from '../../i18n/messages.js';

const detailsChevronUrl = new URL('../../../assets/event-details-chevron.svg', import.meta.url).href;

export type EventSummaryProps = Readonly<{
  occurrence: BuyerOccurrenceSummary;
  locale?: string;
  onDetails?: () => void;
  className?: string;
}>;

function formatOccurrenceDate(
  startsAt: string,
  timeZone: string,
  locale: string,
): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(new Date(startsAt));
  } catch {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(startsAt));
  }
}

export function EventSummary({
  occurrence,
  locale = 'ru-RU',
  onDetails,
  className = '',
}: EventSummaryProps) {
  const messages = getPurchaseMessages(locale);
  return (
    <article className={`tp-event-summary ${className}`}>
      {occurrence.poster && (
        <img
          className="tp-event-summary__poster"
          src={occurrence.poster.url}
          alt={occurrence.poster.alt}
        />
      )}
      <div className="tp-event-summary__body">
        <h2 className="tp-event-summary__title" title={occurrence.title}>
          {occurrence.title}
        </h2>
        <p className="tp-event-summary__when">
          <time dateTime={occurrence.startsAt}>
            {formatOccurrenceDate(occurrence.startsAt, occurrence.timeZone, locale)}
          </time>
        </p>
        <p className="tp-event-summary__venue">
          {occurrence.venue.name}, {occurrence.venue.city}
        </p>
        {onDetails && (
          <Button
            className="tp-event-summary__details"
            tone="quiet"
            size="sm"
            onClick={onDetails}
          >
            {messages.eventDetails}
            <img
              className="tp-event-summary__chevron"
              src={detailsChevronUrl}
              alt=""
              aria-hidden="true"
            />
          </Button>
        )}
      </div>
    </article>
  );
}

