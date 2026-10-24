export function parsePropertyValue(
  raw: string,
  kind: 'text' | 'number',
  options: { min?: number; max?: number; integer?: boolean } = {},
): { value: string | number } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed)
    return { error: kind === 'number' ? 'Введите число' : 'Введите значение' };
  if (kind === 'text') return { value: trimmed };
  const number = Number(trimmed);
  if (!Number.isFinite(number)) return { error: 'Введите конечное число' };
  if (options.min !== undefined && number < options.min)
    return { error: `Значение должно быть не меньше ${options.min}` };
  if (options.max !== undefined && number > options.max)
    return { error: `Значение должно быть не больше ${options.max}` };
  if (options.integer && !Number.isInteger(number))
    return { error: 'Введите целое число' };
  return { value: number };
}
