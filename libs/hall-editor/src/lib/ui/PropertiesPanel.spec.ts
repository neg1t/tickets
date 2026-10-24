import { describe, expect, it } from 'vitest';
import { parsePropertyValue } from './propertyValidation.js';

describe('property input validation', () => {
  it('rejects empty and nonfinite numeric values instead of converting them to zero', () => {
    expect(parsePropertyValue('', 'number')).toEqual({
      error: 'Введите число',
    });
    expect(parsePropertyValue('Infinity', 'number')).toEqual({
      error: 'Введите конечное число',
    });
  });

  it('accepts a finite coordinate and rejects negative dimensions', () => {
    expect(parsePropertyValue('-2.5', 'number')).toEqual({ value: -2.5 });
    expect(parsePropertyValue('-2', 'number', { min: 0.01 })).toEqual({
      error: 'Значение должно быть не меньше 0.01',
    });
  });

  it('requires whole GA capacity and opacity within its range', () => {
    expect(
      parsePropertyValue('2.5', 'number', { min: 1, integer: true }),
    ).toEqual({
      error: 'Введите целое число',
    });
    expect(
      parsePropertyValue('20', 'number', { min: 1, integer: true }),
    ).toEqual({
      value: 20,
    });
    expect(parsePropertyValue('1.2', 'number', { min: 0, max: 1 })).toEqual({
      error: 'Значение должно быть не больше 1',
    });
  });
});
