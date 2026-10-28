export type PricingLocale = 'ru' | 'en';

export type PricingLabels = Readonly<{
  title: string;
  zones: string;
  undo: string;
  redo: string;
  clear: string;
  assign: string;
  save: string;
  saving: string;
  preview: string;
  segments: string;
  emptyCatalog: string;
  noZones: string;
  coverage: string;
  unassigned: string;
  assigned: string;
  mixed: string;
  partiallyAssigned: string;
  invalid: string;
  selectSegment: string;
  catalogChanged: string;
  acceptCatalog: string;
  readonly: string;
  loading: string;
  dirty: string;
  clean: string;
  historyTruncated: string;
  invalidAssignments: string;
  contextMismatch: string;
  issue: string;
  seatsCount: (count: number) => string;
  gaCount: (count: number) => string;
}>;

const labelsByLocale: Record<PricingLocale, PricingLabels> = {
  ru: {
    title: 'Цены и сегменты',
    zones: 'Сектора',
    undo: 'Отменить',
    redo: 'Повторить',
    clear: 'Очистить выбранное',
    assign: 'Назначить выбранным',
    save: 'Сохранить цены',
    saving: 'Сохранение…',
    preview: 'Предпросмотр покупателя',
    segments: 'Ценовые сегменты',
    emptyCatalog: 'Для сеанса пока нет ценовых сегментов.',
    noZones: 'В этой схеме нет секторов.',
    coverage: 'Покрытие ценами',
    unassigned: 'Без цены',
    assigned: 'Назначен',
    mixed: 'Смешанные цены',
    partiallyAssigned: 'Частично назначен',
    invalid: 'Ошибка схемы',
    selectSegment: 'Выберите ценовой сегмент',
    catalogChanged: 'Каталог цен изменился. Проверьте его, прежде чем продолжить.',
    acceptCatalog: 'Подтвердить версию каталога',
    readonly: 'Доступен только просмотр.',
    loading: 'Загрузка цен…',
    dirty: 'Есть несохранённые изменения',
    clean: 'Все изменения сохранены',
    historyTruncated: 'Старая история действий очищена из-за ограничения размера.',
    invalidAssignments: 'Исправьте ошибки назначений перед сохранением.',
    contextMismatch: 'Схема, сеанс и каталог относятся к разным контекстам.',
    issue: 'Проверка',
    seatsCount: (count) => `${count} ${count === 1 ? 'место' : 'мест'}`,
    gaCount: (count) => `${count} зон`,
  },
  en: {
    title: 'Pricing policy',
    zones: 'Zones',
    undo: 'Undo',
    redo: 'Redo',
    clear: 'Clear selected',
    assign: 'Assign to selected',
    save: 'Save prices',
    saving: 'Saving…',
    preview: 'Buyer preview',
    segments: 'Pricing segments',
    emptyCatalog: 'This occurrence has no pricing segments yet.',
    noZones: 'This layout has no zones.',
    coverage: 'Price coverage',
    unassigned: 'Unpriced',
    assigned: 'Assigned',
    mixed: 'Mixed prices',
    partiallyAssigned: 'Partially assigned',
    invalid: 'Invalid layout',
    selectSegment: 'Select a pricing segment',
    catalogChanged: 'The pricing catalog changed. Review it before continuing.',
    acceptCatalog: 'Accept catalog revision',
    readonly: 'Read-only view.',
    loading: 'Loading prices…',
    dirty: 'Unsaved changes',
    clean: 'All changes saved',
    historyTruncated: 'Older command history was removed to stay within the size limit.',
    invalidAssignments: 'Fix assignment issues before saving.',
    contextMismatch: 'The layout, occurrence, and catalog contexts do not match.',
    issue: 'Check',
    seatsCount: (count) => `${count} ${count === 1 ? 'seat' : 'seats'}`,
    gaCount: (count) => `${count} zones`,
  },
};

export function getPricingLabels(locale?: string): PricingLabels {
  return labelsByLocale[locale?.toLowerCase().startsWith('en') ? 'en' : 'ru'];
}
