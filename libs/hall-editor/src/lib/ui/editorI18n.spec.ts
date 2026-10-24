import { describe, expect, it } from 'vitest';
import { editorText, translateEditorError } from './editorI18n.js';
import { readFileSync } from 'node:fs';

describe('editor localization', () => {
  it('keeps Russian by default and translates editor actions for English', () => {
    expect(editorText(undefined, 'Сохранить')).toBe('Сохранить');
    expect(editorText('en', 'Сохранить')).toBe('Save');
    expect(editorText('en-US', 'Опубликовать')).toBe('Publish');
    expect(editorText('en', 'Мест в ряду')).toBe('Seats in row');
  });

  it('translates numeric validation errors and preserves unknown details', () => {
    expect(translateEditorError('en', 'Введите конечное число')).toBe(
      'Enter a finite number',
    );
    expect(
      translateEditorError('en', 'Значение должно быть не меньше 0.01'),
    ).toBe('Value must be at least 0.01');
    expect(translateEditorError('en', 'Custom failure')).toBe('Custom failure');
    expect(translateEditorError('en', 'Ряд «A» не содержит мест')).toBe(
      'Row “A” has no seats',
    );
    expect(translateEditorError('en', 'Места 1 и 2 пересекаются')).toBe(
      'Seats 1 and 2 overlap',
    );
  });

  it('covers all static editor and generation labels', () => {
    const files = [
      new URL('../HallEditor.tsx', import.meta.url),
      new URL('./GenerationControls.tsx', import.meta.url),
    ];
    const missing = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [
        ...source.matchAll(
          /tr\(\s*(?:'([^']*[А-Яа-я][^']*)'|"([^"]*[А-Яа-я][^"]*)")\s*\)/g,
        ),
      ]
        .map((match) => match[1] ?? match[2] ?? '')
        .filter((label) => /[А-Яа-я]/.test(editorText('en', label)));
    });
    expect([...new Set(missing)]).toEqual([]);
  });
});
