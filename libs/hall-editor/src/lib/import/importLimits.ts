import { MAX_PDF_BYTES, MAX_PDF_PAGES } from '@hall-platform/pdf';

export const MAX_PDF_IMPORT_BYTES = MAX_PDF_BYTES;
export const MAX_JSON_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_IMPORT_PAGES = MAX_PDF_PAGES;
export const MAX_DRAFT_OBJECTS = 50_000;
export const MAX_DRAFT_PAGES = 2_000;

export type ImportKind = 'pdf' | 'json';

export function assertImportBytes(byteLength: number, kind: ImportKind): void {
  const maximum = kind === 'pdf' ? MAX_PDF_IMPORT_BYTES : MAX_JSON_IMPORT_BYTES;
  if (!Number.isSafeInteger(byteLength) || byteLength < 1)
    throw new RangeError('Файл пуст или имеет неверный размер');
  if (byteLength > maximum)
    throw new RangeError(
      kind === 'pdf'
        ? 'PDF должен быть не больше 20 МБ'
        : 'JSON должен быть не больше 20 МБ',
    );
}

export function assertImportFile(
  file: Pick<File, 'name' | 'type' | 'size'>,
  kind: ImportKind,
): void {
  assertImportBytes(file.size, kind);
  const expectedType = kind === 'pdf' ? 'application/pdf' : 'application/json';
  if (
    file.type !== expectedType &&
    !file.name.toLowerCase().endsWith(`.${kind}`)
  )
    throw new TypeError(
      kind === 'pdf' ? 'Выберите PDF-файл' : 'Выберите JSON-файл',
    );
}

export function assertDraftImportLimits(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const draft = value as Record<string, unknown>;
  const snapshot = draft.snapshot;
  if (snapshot && typeof snapshot === 'object') {
    const collections = snapshot as Record<string, unknown>;
    let total = 0;
    for (const key of [
      'floors',
      'zones',
      'rows',
      'seats',
      'tables',
      'backgrounds',
      'decorations',
    ]) {
      const items = collections[key];
      if (Array.isArray(items)) total += items.length;
      if (total > MAX_DRAFT_OBJECTS)
        throw new RangeError('Схема содержит слишком много объектов');
    }
  }
  const assets = draft.assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return;
  const entries = Object.values(assets);
  if (entries.length > MAX_DRAFT_OBJECTS)
    throw new RangeError('Схема содержит слишком много файлов');
  let totalPages = 0;
  for (const asset of entries) {
    if (!asset || typeof asset !== 'object') continue;
    const pages = (asset as Record<string, unknown>).pages;
    if (Array.isArray(pages)) {
      if (pages.length > MAX_PDF_IMPORT_PAGES)
        throw new RangeError('PDF содержит слишком много страниц');
      totalPages += pages.length;
      if (totalPages > MAX_DRAFT_PAGES)
        throw new RangeError('Схема содержит слишком много PDF-страниц');
    }
  }
}
