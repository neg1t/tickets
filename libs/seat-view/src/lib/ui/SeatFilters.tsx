import type { ChangeEvent } from 'react';

export function SeatFilters({
  floorLabel,
  zoneLabel,
  searchLabel,
  availableOnlyLabel,
  floors,
  zones,
  floorId,
  zoneId,
  search,
  availableOnly,
  onFloorChange,
  onZoneChange,
  onSearchChange,
  onAvailableOnlyChange,
}: Readonly<{
  floorLabel: string;
  zoneLabel: string;
  searchLabel: string;
  availableOnlyLabel: string;
  floors: readonly Readonly<{ id: string; name: string }>[];
  zones: readonly Readonly<{ id: string; name: string }>[];
  floorId: string;
  zoneId: string;
  search: string;
  availableOnly: boolean;
  onFloorChange: (id: string) => void;
  onZoneChange: (id: string | null) => void;
  onSearchChange: (value: string) => void;
  onAvailableOnlyChange: (value: boolean) => void;
}>) {
  return (
    <div className="seat-view-filter-section">
      <div className="seat-view-filters">
        <label>
          {floorLabel}
          <select
            aria-label={floorLabel}
            value={floorId}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              onFloorChange(event.target.value)
            }
          >
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {zoneLabel}
          <select
            aria-label={zoneLabel}
            value={zoneId}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              onZoneChange(event.target.value || null)
            }
          >
            <option value="">{zoneLabel}</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="seat-view-search">
        {searchLabel}
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      <label className="seat-view-available-filter">
        <input
          type="checkbox"
          checked={availableOnly}
          onChange={(event) => onAvailableOnlyChange(event.target.checked)}
        />
        {availableOnlyLabel}
      </label>
    </div>
  );
}
