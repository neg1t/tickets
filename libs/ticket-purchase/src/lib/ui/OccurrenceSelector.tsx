import type { BuyerOccurrenceSummary } from '@hall-platform/api-contracts';
import { Select } from '@hall-platform/ui';
import { groupOccurrencesByLocalDate } from '../model/purchaseEffects.js';

export type OccurrenceSelectorProps = Readonly<{
  occurrences: readonly BuyerOccurrenceSummary[];
  selectedOccurrenceId: string;
  timeZone: string;
  locale: string;
  disabled?: boolean;
  onChange: (occurrenceId: string) => void;
}>;

export function OccurrenceSelector({
  occurrences,
  selectedOccurrenceId,
  timeZone,
  locale,
  disabled = false,
  onChange,
}: OccurrenceSelectorProps) {
  if (occurrences.length === 0) return null;
  const groups = groupOccurrencesByLocalDate(occurrences, timeZone, locale);
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Select
      className="tp-occurrence-selector"
      label={locale.toLowerCase().startsWith('en') ? 'Event time' : 'Дата и время'}
      value={selectedOccurrenceId}
      disabled={disabled || occurrences.length < 2}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {groups.map((group) => (
        <optgroup key={group.dateKey} label={group.dateLabel}>
          {group.items.map((occurrence) => (
            <option key={occurrence.occurrenceId} value={occurrence.occurrenceId}>
              {timeFormatter.format(new Date(occurrence.startsAt))}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
