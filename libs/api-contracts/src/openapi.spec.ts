import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openApiDocument } from './openapi.js';

describe('OpenAPI contract', () => {
  it('describes versioned hall and booking routes with security and conflict responses', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/halls');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/layouts/{id}/publish');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/occurrences/{id}/holds');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/occurrences/{id}/pricing-segments');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/occurrences/{id}/pricing-assignments');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/orders/{id}/checkout');
    expect(openApiDocument.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(openApiDocument.paths['/api/v1/layouts/{id}/draft'].put.responses).toHaveProperty('409');
  });

  it('documents the separate v2 buyer flow and revision refresh semantics', () => {
    const schemas = openApiDocument.components.schemas as unknown as Record<string, Record<string, unknown>>;
    expect(openApiDocument.paths).toHaveProperty('/api/v2/buyer/events/{eventId}/occurrences');
    expect(openApiDocument.paths).toHaveProperty('/api/v2/buyer/occurrences/{id}/seat-map');
    expect(openApiDocument.paths).toHaveProperty('/api/v2/buyer/sessions/current/resume');
    expect(openApiDocument.paths).toHaveProperty('/api/v2/buyer/orders/{id}/checkout');
    expect(openApiDocument.paths).toHaveProperty('/api/v2/buyer/orders/{id}/tickets');
    expect((schemas.BuyerOccurrenceList!.properties as Record<string, unknown>).apiVersion)
      .toMatchObject({ const: 'v2', type: 'string' });
    const publicLayoutProperties = schemas.BuyerPublicLayout!.properties as Record<string, unknown>;
    const publicSnapshotProperties = (publicLayoutProperties.snapshot as Record<string, unknown>).properties as Record<string, unknown>;
    expect(publicSnapshotProperties.backgrounds)
      .toMatchObject({ maxItems: 0 });
    const checkout = (openApiDocument.paths as unknown as Record<string, { post: Record<string, unknown> }>)[
      '/api/v2/buyer/orders/{id}/checkout']!.post;
    expect(checkout.description)
      .toContain('Reads do not mutate revision');
    expect(((checkout.responses as Record<string, { description: string }>)['409']!).description)
      .toContain('currentRevision');
  });

  it('separates buyer-session paths, credentials, and purchase-session selection from admin JWT', () => {
    const paths = openApiDocument.paths as unknown as Record<string, {
      get?: Record<string, unknown>;
      post?: Record<string, unknown>;
      put?: Record<string, unknown>;
      delete?: Record<string, unknown>;
    }>;
    const operation = (path: string, method: 'get' | 'post' | 'put' | 'delete') =>
      paths[path]?.[method] as Record<string, unknown>;
    expect(paths).toHaveProperty('/api/v2/buyer/sessions');
    expect(paths).toHaveProperty('/api/v2/buyer/sessions/current/resume');
    expect(paths).toHaveProperty('/api/v2/buyer/sessions/current/contact');
    expect(paths).toHaveProperty('/api/v2/buyer/sessions/current/email-challenges');
    expect(paths).toHaveProperty('/api/v2/buyer/email-challenges/{id}/verify');
    expect(openApiDocument.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(openApiDocument.components.securitySchemes).toHaveProperty('buyerSessionAuth');
    expect(operation('/api/v2/buyer/sessions', 'post').security).toEqual([]);
    const sessionScoped = [
      ['/api/v2/buyer/occurrences/{id}/context', 'get'],
      ['/api/v2/buyer/holds/{id}', 'get'],
      ['/api/v2/buyer/occurrences/{id}/holds', 'post'],
      ['/api/v2/buyer/holds/{id}', 'delete'],
      ['/api/v2/buyer/sessions/current/resume', 'get'],
      ['/api/v2/buyer/sessions/current/contact', 'put'],
      ['/api/v2/buyer/sessions/current/email-challenges', 'post'],
      ['/api/v2/buyer/email-challenges/{id}/verify', 'post'],
      ['/api/v2/buyer/orders', 'post'],
      ['/api/v2/buyer/orders/{id}/quotes', 'post'],
      ['/api/v2/buyer/orders/{id}/checkout', 'post'],
      ['/api/v2/buyer/orders/{id}', 'get'],
      ['/api/v2/buyer/orders/{id}/tickets', 'get'],
    ] as const;
    for (const [path, method] of sessionScoped) {
      const scopedOperation = operation(path, method);
      expect(scopedOperation.security, path).toEqual([{ buyerSessionAuth: [] }]);
      expect(scopedOperation.parameters, path).toContainEqual({ $ref: '#/components/parameters/PurchaseSessionId' });
    }
  });

  it('uses the approved v2 buyer resource paths without alternate aliases', () => {
    const paths = openApiDocument.paths;
    expect(paths).toHaveProperty('/api/v2/buyer/events/{eventId}/occurrences');
    expect(paths).toHaveProperty('/api/v2/buyer/occurrences/{id}/context');
    expect(paths).toHaveProperty('/api/v2/buyer/occurrences/{id}/seat-map');
    expect(paths).toHaveProperty('/api/v2/buyer/occurrences/{id}/availability');
    expect(paths).toHaveProperty('/api/v2/buyer/occurrences/{id}/availability-changes');
    expect(paths).toHaveProperty('/api/v2/buyer/occurrences/{id}/prices');
    expect(paths).toHaveProperty('/api/v2/buyer/holds/{id}');
    expect(paths).toHaveProperty('/api/v2/buyer/orders/{id}');
    expect(paths).toHaveProperty('/api/v2/buyer/orders/{id}/tickets');
    expect(paths).not.toHaveProperty('/api/v2/buyer/occurrences');
    expect(paths).not.toHaveProperty('/api/v2/buyer/occurrences/{id}');
    expect(paths).not.toHaveProperty('/api/v2/buyer/occurrences/{id}/layout');
    expect(paths).not.toHaveProperty('/api/v2/buyer/tickets');
  });

  it('uses the planned plural quote route and requires a revision when cancelling a hold', () => {
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, {
      parameters?: unknown[];
      description?: string;
      responses?: Record<string, {
        description?: string;
        content?: Record<string, { examples?: Record<string, { value?: unknown }> }>;
      }>;
    }>>;
    expect(paths).toHaveProperty('/api/v2/buyer/orders/{id}/quotes');
    expect(paths).not.toHaveProperty('/api/v2/buyer/orders/{id}/quote');

    const holdOperations = paths['/api/v2/buyer/holds/{id}'];
    const cancelHold = holdOperations?.delete;
    if (!cancelHold) throw new Error('Expected DELETE /api/v2/buyer/holds/{id}');
    expect(cancelHold.parameters).toContainEqual({ $ref: '#/components/parameters/IfMatch' });
    expect(openApiDocument.components.parameters.IfMatch).toMatchObject({
      in: 'header', name: 'If-Match', required: true,
    });
    expect(cancelHold.description).toContain('expected hold revision');
    expect(cancelHold.description).toContain('cancellation and conversion');
    const conflict = cancelHold.responses?.['409'];
    if (!conflict) throw new Error('Expected a 409 cancellation conflict response');
    expect(conflict.description).toContain('conversion');
    expect(conflict.content?.['application/json']?.examples).toHaveProperty('holdConverted');
  });

  it('lists unresolved backend and native integration decisions in the OpenAPI handoff', () => {
    const description = openApiDocument.info.description.toLowerCase();
    for (const decision of [
      'guest mode', 'session ttl', 'token refresh', 'redirect/deep-link allowlist',
      'otp provider', 'fees and discounts', 'payment provider', 'ticket issuance',
      'session restoration', 'payment inventory lease', 'late provider callbacks',
    ]) {
      expect(description).toContain(decision);
    }
  });

  it('assigns a distinct purchase session to every widget instance', () => {
    const createSession = openApiDocument.paths['/api/v2/buyer/sessions'].post;
    const purchaseSessionHeader = openApiDocument.components.parameters.PurchaseSessionId;

    expect(createSession.description).toContain('Each widget instance gets its own purchase session');
    expect(createSession.description).toContain('must not share its purchaseSessionId with another widget instance');
    expect(purchaseSessionHeader.description).toContain('Do not share this selector between widget instances');
  });

  it('requires buyer mutation revisions and documents expired and unprocessable responses', () => {
    const paths = openApiDocument.paths as unknown as Record<string, {
      post?: Record<string, unknown>;
      put?: Record<string, unknown>;
    }>;
    const contact = paths['/api/v2/buyer/sessions/current/contact']!.put as Record<string, unknown>;
    const quote = paths['/api/v2/buyer/orders/{id}/quotes']!.post as Record<string, unknown>;
    const schemas = openApiDocument.components.schemas as unknown as Record<string, { required?: string[] }>;
    const contactResponses = contact.responses as Record<string, unknown>;
    const quoteResponses = quote.responses as Record<string, unknown>;
    const requiredFields = (name: string) => {
      const schema = schemas[name];
      if (!schema?.required) throw new Error(`Expected required fields for ${name}`);
      return schema.required;
    };
    expect(requiredFields('BuyerContactWrite')).toContain('contactRevision');
    expect(requiredFields('BuyerQuoteRequest')).toContain('orderRevision');
    expect(requiredFields('BuyerHoldRequest')).toContain('availabilityRevision');
    expect(requiredFields('BuyerHoldRequest')).toContain('pricingRevision');
    expect(requiredFields('BuyerOrderRequest')).toContain('contactRevision');
    expect(requiredFields('BuyerCheckoutRequest')).toEqual(expect.arrayContaining(['quoteRevision', 'orderRevision']));
    expect(contactResponses).toHaveProperty('410');
    expect(contactResponses).not.toHaveProperty('422');
    expect(quoteResponses).toHaveProperty('410');
    expect(quoteResponses).toHaveProperty('422');
    expect((quoteResponses['409'] as { description: string }).description).toContain('currentRevision');
  });

  it('checks the expected price revision before atomically creating a buyer hold', () => {
    const hold = openApiDocument.paths['/api/v2/buyer/occurrences/{id}/holds'].post;
    type JsonExample = { value: Record<string, unknown> };
    type Examples = Record<string, JsonExample | undefined>;
    const requestExamples = hold.requestBody.content['application/json'].examples as Examples;
    const responses = hold.responses as unknown as Record<string, { content: Record<string, { examples: Examples }> }>;
    const conflictExamples = responses['409']?.content['application/json']?.examples;
    const seatedExample = requestExamples.seatedSelection?.value;
    const priceChanged = conflictExamples?.priceChanged?.value;
    if (!seatedExample || !priceChanged) throw new Error('Expected seated hold and stale-price examples');

    expect(hold.description).toContain('pricingRevision');
    expect(hold.description).toContain('price_changed');
    expect(seatedExample).toMatchObject({ availabilityRevision: 44, pricingRevision: 12 });
    expect(priceChanged).toMatchObject({ code: 'price_changed', currentRevision: 13 });
    expect(priceChanged.message as string).toContain('pricingRevision');
  });

  it('keeps stale pricing conflicts on hold creation and gives checkout revision-specific guidance', () => {
    const hold = openApiDocument.paths['/api/v2/buyer/occurrences/{id}/holds'].post;
    const checkout = openApiDocument.paths['/api/v2/buyer/orders/{id}/checkout'].post;
    const holdResponses = hold.responses as unknown as Record<string, {
      content: Record<string, { examples: Record<string, unknown> }>;
    }>;
    const checkoutResponses = checkout.responses as unknown as Record<string, {
      content: Record<string, { examples: Record<string, unknown> }>;
    }>;
    const holdConflictExamples = holdResponses['409']?.content['application/json']?.examples;
    const checkoutConflictExamples = checkoutResponses['409']?.content['application/json']?.examples;
    if (!holdConflictExamples || !checkoutConflictExamples) throw new Error('Expected hold and checkout conflict examples');

    expect(holdConflictExamples).toHaveProperty('priceChanged');
    expect(checkoutConflictExamples).not.toHaveProperty('priceChanged');
    expect(checkoutConflictExamples).toHaveProperty('checkoutRevisionConflict');
    expect(checkout.description).toContain('create a fresh quote');
    expect(checkout.description).toContain('reconfirm its total');
  });

  it('uses null promoCode to clear a promotion when quoting again', () => {
    const quote = openApiDocument.paths['/api/v2/buyer/orders/{id}/quotes'].post;
    const requestExamples = quote.requestBody.content['application/json'].examples as Record<string, { value: Record<string, unknown> } | undefined>;
    const clearPromotion = requestExamples.clearPromotion?.value;
    if (!clearPromotion) throw new Error('Expected the explicit promotion-clear example');

    expect(quote.description).toContain('null to explicitly clear a promotion');
    expect(clearPromotion).toMatchObject({ apiVersion: 'v2', orderRevision: 8, promoCode: null });
  });

  it('gives every v2 buyer operation examples and backend transaction guidance', () => {
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const buyerOperations = Object.entries(paths)
      .filter(([path]) => path.startsWith('/api/v2/buyer/'))
      .flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => ({ path, method, operation })));

    expect(buyerOperations.length).toBeGreaterThan(0);
    for (const { path, method, operation } of buyerOperations) {
      expect(operation.description, `${method.toUpperCase()} ${path} description`).toContain('backend owns durable purchase state');
      expect(operation.description, `${method.toUpperCase()} ${path} abort semantics`).toContain('AbortSignal abort does not cancel a mutation');
      if (method !== 'get') {
        expect(operation.parameters, `${method.toUpperCase()} ${path} idempotency`)
          .toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' });
      }

      const requestBody = operation.requestBody as { content?: Record<string, { examples?: Record<string, unknown> }> } | undefined;
      if (requestBody) {
        expect(requestBody.content?.['application/json']?.examples, `${method.toUpperCase()} ${path} request examples`)
          .toBeDefined();
      }

      const responses = operation.responses as Record<string, { content?: Record<string, { examples?: Record<string, unknown> }> }>;
      for (const [status, response] of Object.entries(responses)) {
        const examples = response.content?.['application/json']?.examples;
        if (response.content?.['application/json']) {
          expect(examples, `${method.toUpperCase()} ${path} ${status} examples`).toBeDefined();
        }
      }
    }
  });

  it('keeps public buyer listing and layout responses independent of buyer session errors', () => {
    const publicOperations = [
      openApiDocument.paths['/api/v2/buyer/events/{eventId}/occurrences'].get,
      openApiDocument.paths['/api/v2/buyer/occurrences/{id}/seat-map'].get,
      openApiDocument.paths['/api/v2/buyer/occurrences/{id}/availability'].get,
      openApiDocument.paths['/api/v2/buyer/occurrences/{id}/availability-changes'].get,
      openApiDocument.paths['/api/v2/buyer/occurrences/{id}/prices'].get,
    ] as unknown as Array<{ security?: unknown; responses: Record<string, { description: string }> }>;

    for (const operation of publicOperations) {
      expect(operation.security).toEqual([]);
      expect(operation.responses).not.toHaveProperty('401');
      expect(operation.responses).not.toHaveProperty('403');
      expect(operation.responses).not.toHaveProperty('410');
      const unavailable = operation.responses['503'];
      if (!unavailable) throw new Error('Expected a 503 response');
      expect(unavailable.description).toContain('read request');
    }
  });

  it('documents an expired hold and a successful payment with asynchronous ticket delivery', () => {
    const createOrder = openApiDocument.paths['/api/v2/buyer/orders'].post;
    const checkout = openApiDocument.paths['/api/v2/buyer/orders/{id}/checkout'].post;
    type ExampleResponse = { content: Record<string, { examples: Record<string, { value: unknown }> }> };
    const createOrderResponses = createOrder.responses as unknown as Record<string, ExampleResponse>;
    const checkoutResponses = checkout.responses as unknown as Record<string, ExampleResponse>;
    const holdExpiredResponse = createOrderResponses['410'];
    const checkoutResponse = checkoutResponses['200'];
    if (!holdExpiredResponse || !checkoutResponse) throw new Error('Expected order and checkout responses');
    const holdExpiredContent = holdExpiredResponse.content['application/json'];
    const checkoutContent = checkoutResponse.content['application/json'];
    if (!holdExpiredContent || !checkoutContent) throw new Error('Expected JSON response examples');
    const holdExpiredExample = holdExpiredContent.examples.holdExpired;
    const paidDeliveryExample = checkoutContent.examples.paidDeliveryPending;
    if (!holdExpiredExample || !paidDeliveryExample) throw new Error('Expected expired-hold and paid-delivery examples');
    const holdExpired = holdExpiredExample.value as Record<string, unknown>;
    const paymentPendingTickets = paidDeliveryExample.value as Record<string, unknown>;

    expect(holdExpired).toMatchObject({ apiVersion: 'v2', code: 'hold_expired' });
    expect(paymentPendingTickets.order).toMatchObject({
      status: 'confirmed', paymentStatus: 'paid', ticketDeliveryStatus: 'pending',
    });
    expect((paymentPendingTickets.paymentAttempt as Record<string, unknown>).status).toBe('succeeded');
  });

  it('defines mutation replay, revision, rate-limit, and uncertain-timeout semantics', () => {
    const idempotency = openApiDocument.components.parameters.IdempotencyKey.description;
    expect(idempotency).toContain('same body');
    expect(idempotency).toContain('409');
    expect(idempotency).toContain('same response');
    const quote = openApiDocument.paths['/api/v2/buyer/orders/{id}/quotes'].post;
    const checkout = openApiDocument.paths['/api/v2/buyer/orders/{id}/checkout'].post;
    expect(quote.description).toContain('orderRevision');
    expect(checkout.description).toContain('orderRevision');
    const responses = quote.responses as unknown as Record<string, {
      description: string;
      content: Record<string, { examples: Record<string, { value: Record<string, unknown> }> }>;
    }>;
    const rateLimited = responses['429'];
    const unavailable = responses['503'];
    if (!rateLimited || !unavailable) throw new Error('Expected 429 and 503 responses');
    const rateLimitedContent = rateLimited.content['application/json'];
    if (!rateLimitedContent) throw new Error('Expected a JSON rate-limit response');
    const rateLimitedExample = rateLimitedContent.examples.rateLimited;
    if (!rateLimitedExample) throw new Error('Expected a rate-limit example');
    expect(rateLimitedExample.value.retryAfterMs).toBeGreaterThan(0);
    expect(unavailable.description).toContain('same Idempotency-Key');
  });

  it('describes minor-unit money and an idempotency header', () => {
    expect(openApiDocument.components.schemas.Money).toMatchObject({
      properties: { amountMinor: { type: 'integer', minimum: 0 }, currency: { type: 'string' } },
    });
    expect(openApiDocument.components.parameters.IdempotencyKey).toMatchObject({
      in: 'header', name: 'Idempotency-Key', required: true,
    });
  });

  it('documents empty, mixed seated, GA, and conflict pricing payloads', () => {
    const getAssignments = openApiDocument.paths['/api/v1/occurrences/{id}/pricing-assignments'].get;
    const putAssignments = openApiDocument.paths['/api/v1/occurrences/{id}/pricing-assignments'].put;
    const readExamples = getAssignments.responses['200'].content['application/json'].examples;
    const writeExamples = putAssignments.requestBody.content['application/json'].examples;
    const conflictExamples = putAssignments.responses['409'].content['application/json'].examples;

    expect(readExamples).toHaveProperty('emptyAssignments');
    expect(readExamples).toHaveProperty('mixedSeatedZone');
    expect(readExamples).toHaveProperty('generalAdmissionZone');
    expect(writeExamples).toHaveProperty('emptyAssignments');
    expect(writeExamples).toHaveProperty('mixedSeatedZone');
    expect(writeExamples).toHaveProperty('generalAdmissionZone');
    expect(conflictExamples).toHaveProperty('catalogChanged');
    expect(conflictExamples).toHaveProperty('layoutChanged');
    expect(conflictExamples).toHaveProperty('invalidTarget');
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
