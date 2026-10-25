import { describe, expect, it } from 'vitest';
import { createEmptyDraft } from '../editorDraft.js';
import {
  assertDraftImportLimits,
  assertImportBytes,
  assertImportFile,
  MAX_DRAFT_OBJECTS,
  MAX_JSON_IMPORT_BYTES,
  MAX_PDF_IMPORT_BYTES,
  MAX_PDF_IMPORT_PAGES,
} from './importLimits.js';

const file = (name: string, type: string, size: number) => ({
  name,
  type,
  size,
});

describe('import limits', () => {
  it('rejects oversized PDF files before reading', () => {
    expect(() =>
      assertImportFile(
        file('large.pdf', 'application/pdf', MAX_PDF_IMPORT_BYTES + 1),
        'pdf',
      ),
    ).toThrow(RangeError);
  });

  it('rejects oversized JSON files before reading', () => {
    expect(() =>
      assertImportFile(
        file('large.json', 'application/json', MAX_JSON_IMPORT_BYTES + 1),
        'json',
      ),
    ).toThrow(RangeError);
  });

  it('rejects incorrect file types and empty files', () => {
    expect(() =>
      assertImportFile(file('plan.txt', 'text/plain', 10), 'pdf'),
    ).toThrow(TypeError);
    expect(() =>
      assertImportFile(file('plan.txt', 'text/plain', 10), 'json'),
    ).toThrow(TypeError);
    expect(() =>
      assertImportFile(file('plan.pdf', 'application/pdf', 0), 'pdf'),
    ).toThrow(RangeError);
  });

  it('checks actual byte length after reading', () => {
    expect(() => assertImportBytes(MAX_PDF_IMPORT_BYTES + 1, 'pdf')).toThrow(
      RangeError,
    );
    expect(() => assertImportBytes(MAX_JSON_IMPORT_BYTES + 1, 'json')).toThrow(
      RangeError,
    );
  });

  it('rejects too many draft objects before schema parsing', () => {
    const draft = createEmptyDraft('Hall');
    const seats = Array.from({ length: MAX_DRAFT_OBJECTS + 1 });
    expect(() =>
      assertDraftImportLimits({
        ...draft,
        snapshot: { ...draft.snapshot, seats },
      }),
    ).toThrow(RangeError);
  });

  it('rejects imported assets with too many PDF pages', () => {
    const draft = createEmptyDraft('Hall');
    expect(() =>
      assertDraftImportLimits({
        ...draft,
        assets: {
          pdf: { pages: Array.from({ length: MAX_PDF_IMPORT_PAGES + 1 }) },
        },
      }),
    ).toThrow(RangeError);
  });

  it('rejects too many PDF pages across imported assets', () => {
    const draft = createEmptyDraft('Hall');
    const assets = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `asset-${index}`,
        { pages: Array.from({ length: MAX_PDF_IMPORT_PAGES }) },
      ]),
    );
    expect(() => assertDraftImportLimits({ ...draft, assets })).toThrow(
      RangeError,
    );
  });

  it('accepts an empty draft', () => {
    expect(() =>
      assertDraftImportLimits(createEmptyDraft('Hall')),
    ).not.toThrow();
  });
});
