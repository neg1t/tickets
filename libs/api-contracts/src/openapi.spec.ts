import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openApiDocument } from './openapi.js';

describe('OpenAPI contract', () => {
  it('describes versioned hall and booking routes with security and conflict responses', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/halls');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/layouts/{id}/publish');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/occurrences/{id}/holds');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/orders/{id}/checkout');
    expect(openApiDocument.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(openApiDocument.paths['/api/v1/layouts/{id}/draft'].put.responses).toHaveProperty('409');
  });

  it('describes minor-unit money and an idempotency header', () => {
    expect(openApiDocument.components.schemas.Money).toMatchObject({
      properties: { amountMinor: { type: 'integer', minimum: 0 }, currency: { type: 'string' } },
    });
    expect(openApiDocument.components.parameters.IdempotencyKey).toMatchObject({
      in: 'header', name: 'Idempotency-Key', required: true,
    });
  });

  it('keeps the distributable OpenAPI JSON in sync with runtime schemas', async () => {
    const file = new URL('../openapi.json', import.meta.url);
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk).toEqual(openApiDocument);
  });

  it('has unique operation IDs and only resolvable local references', () => {
    const document = openApiDocument as unknown as Record<string, unknown>;
    const operations = new Set<string>();
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const object = value as Record<string, unknown>;
      if (typeof object['$ref'] === 'string') {
        expect(object['$ref']).toMatch(/^#\//);
        const resolved = object['$ref'].slice(2).split('/').reduce<unknown>((current, part) =>
          current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined,
        document);
        expect(resolved, `Unresolved reference ${object['$ref']}`).toBeDefined();
      }
      if (typeof object['operationId'] === 'string') {
        expect(operations.has(object['operationId']), `Duplicate operation ${object['operationId']}`).toBe(false);
        operations.add(object['operationId']);
      }
      Object.values(object).forEach(visit);
    };
    visit(document);
    expect(operations.size).toBeGreaterThan(15);
  });
});
