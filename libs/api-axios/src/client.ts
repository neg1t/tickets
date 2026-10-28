import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type { HallLayoutDraft } from '@hall-platform/domain';
import {
  apiErrorSchema,
  apiDraftWriteSchema,
  apiHallRecordSchema,
  apiHallListSchema,
  apiHoldRequestSchema,
  apiHoldSchema,
  apiIdempotencyKeySchema,
  apiOccurrenceSchema,
  apiOccurrenceListSchema,
  apiOrderRequestSchema,
  apiOrderSchema,
  apiPublishedVersionSchema,
  apiPublishedVersionListSchema,
  apiPublishResultSchema,
  apiValidationResultSchema,
  apiAssetUploadRequestSchema,
  apiAssetUploadIntentSchema,
  apiAssetSchema,
  apiPublishedLayoutSchema,
  apiSeatAvailabilitySchema,
  apiSeatPricesSchema,
  apiPricingCatalogSchema,
  apiPricingAssignmentsSchema,
  apiPricingAssignmentsWriteSchema,
  type ApiAssetUploadRequest,
  type ApiHallRecord,
  type ApiHallSummary,
  type ApiHold,
  type ApiOccurrence,
  type ApiOrder,
  type ApiPublishedVersion,
  type ApiSeatSelection,
  type ApiPricingCatalog,
  type ApiPricingAssignments,
  type ApiPricingAssignmentsWrite,
  type ApiError,
} from '@hall-platform/api-contracts';

export class HallApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly currentRevision?: number,
    public readonly issues?: ApiError['issues'],
  ) {
    super(message);
    this.name = 'HallApiError';
  }
}

export type HallApiClientOptions = {
  readonly baseURL: string;
  readonly getToken?: () => string | undefined;
  readonly axiosInstance?: AxiosInstance;
};

function input<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new HallApiError('invalid_request', 'Request does not match the API contract');
  }
}

function apiFailure(error: unknown): HallApiError {
  if (error instanceof HallApiError) return error;
  if (axios.isCancel(error)) return new HallApiError('cancelled', 'Request cancelled');
  if (axios.isAxiosError(error)) {
    const parsed = apiErrorSchema.safeParse(error.response?.data);
    if (parsed.success)
      return new HallApiError(
        parsed.data.code,
        parsed.data.message,
        parsed.data.currentRevision,
        parsed.data.issues,
      );
    return new HallApiError(
      error.response ? 'http_error' : 'network_error',
      error.response ? `HTTP ${error.response.status}` : 'Network request failed',
    );
  }
  return new HallApiError('invalid_response', 'Response does not match the API contract');
}

export function createHallApiClient(options: HallApiClientOptions) {
  const http = options.axiosInstance ?? axios.create({ baseURL: options.baseURL });
  const interceptor = http.interceptors.request.use((config) => {
    const token = options.getToken?.();
    if (token) config.headers.set('Authorization', `Bearer ${token}`);
    return config;
  });
  let disposed = false;

  async function request<T>(
    config: AxiosRequestConfig,
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    if (disposed) throw new HallApiError('disposed', 'API client has been disposed');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await http.request<unknown>(config);
        return schema.parse(response.data);
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const retryable =
          config.method?.toUpperCase() === 'GET' &&
          axios.isAxiosError(error) &&
          !axios.isCancel(error) &&
          (status === undefined || status === 429 || status === 503);
        if (!retryable || attempt === 2 || config.signal?.aborted)
          throw apiFailure(error);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            config.signal?.removeEventListener?.('abort', abort);
            resolve();
          }, 50 * (attempt + 1));
          const abort = () => {
            clearTimeout(timer);
            reject(new HallApiError('cancelled', 'Request cancelled'));
          };
          config.signal?.addEventListener?.('abort', abort, { once: true });
        });
      }
    }
    throw new HallApiError('network_error', 'Request failed after retries');
  }

  return {
    async listHalls(signal?: AbortSignal): Promise<ApiHallSummary[]> {
      const result = await request({ method: 'GET', url: '/api/v1/halls',
        ...(signal ? { signal } : {}),
      }, apiHallListSchema);
      return result.items;
    },
    getHall(id: string, signal?: AbortSignal): Promise<ApiHallRecord> {
      return request({ method: 'GET', url: `/api/v1/halls/${encodeURIComponent(id)}`,
        ...(signal ? { signal } : {}),
      }, apiHallRecordSchema);
    },
    async createHall(draft: HallLayoutDraft, idempotencyKey: string, signal?: AbortSignal): Promise<ApiHallRecord> {
      input(apiIdempotencyKeySchema, idempotencyKey);
      return request({
        method: 'POST', url: '/api/v1/halls',
        headers: { 'Idempotency-Key': idempotencyKey },
        data: input(apiDraftWriteSchema, { apiVersion: 'v1', draft }),
        ...(signal ? { signal } : {}),
      }, apiHallRecordSchema);
    },
    async saveDraft(
      draft: HallLayoutDraft,
      expectedRevision: number,
      idempotencyKey: string,
      signal?: AbortSignal,
    ): Promise<ApiHallRecord> {
      input(apiIdempotencyKeySchema, idempotencyKey);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new HallApiError('invalid_request', 'Invalid expected revision');
      return request({
        method: 'PUT',
        url: `/api/v1/layouts/${encodeURIComponent(draft.snapshot.id)}/draft`,
        headers: {
          'If-Match': `"${expectedRevision}"`,
          'Idempotency-Key': idempotencyKey,
        },
        data: input(apiDraftWriteSchema, { apiVersion: 'v1', draft }),
        ...(signal ? { signal } : {}),
      }, apiHallRecordSchema);
    },
    validateDraft(draft: HallLayoutDraft, signal?: AbortSignal) {
      return request({ method: 'POST',
        url: `/api/v1/layouts/${encodeURIComponent(draft.snapshot.id)}/validate`,
        data: input(apiDraftWriteSchema, { apiVersion: 'v1', draft }),
        ...(signal ? { signal } : {}),
      }, apiValidationResultSchema);
    },
    async publishDraft(
      draft: HallLayoutDraft,
      expectedRevision: number,
      idempotencyKey: string,
      warningsAcknowledged = false,
      signal?: AbortSignal,
    ) {
      input(apiIdempotencyKeySchema, idempotencyKey);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new HallApiError('invalid_request', 'Invalid expected revision');
      return request({
        method: 'POST',
        url: `/api/v1/layouts/${encodeURIComponent(draft.snapshot.id)}/publish`,
        headers: {
          'If-Match': `"${expectedRevision}"`,
          'Idempotency-Key': idempotencyKey,
        },
        data: input(apiDraftWriteSchema, { apiVersion: 'v1', draft, warningsAcknowledged }),
        ...(signal ? { signal } : {}),
      }, apiPublishResultSchema);
    },
    async listPublished(id: string, signal?: AbortSignal): Promise<ApiPublishedVersion[]> {
      const result = await request({ method: 'GET',
        url: `/api/v1/layouts/${encodeURIComponent(id)}/versions`,
        ...(signal ? { signal } : {}),
      }, apiPublishedVersionListSchema);
      return result.items;
    },
    getPublished(id: string, signal?: AbortSignal): Promise<ApiPublishedVersion> {
      return request({ method: 'GET',
        url: `/api/v1/layout-versions/${encodeURIComponent(id)}`,
        ...(signal ? { signal } : {}),
      }, apiPublishedVersionSchema);
    },
    createAssetUploadIntent(value: ApiAssetUploadRequest, idempotencyKey: string, signal?: AbortSignal) {
      input(apiIdempotencyKeySchema, idempotencyKey);
      return request({ method: 'POST', url: '/api/v1/assets/upload-intents',
        headers: { 'Idempotency-Key': idempotencyKey },
        data: input(apiAssetUploadRequestSchema, value),
        ...(signal ? { signal } : {}),
      }, apiAssetUploadIntentSchema);
    },
    completeAssetUpload(id: string, idempotencyKey: string, signal?: AbortSignal) {
      input(apiIdempotencyKeySchema, idempotencyKey);
      return request({ method: 'POST', url: `/api/v1/assets/${encodeURIComponent(id)}/complete`,
        headers: { 'Idempotency-Key': idempotencyKey },
        ...(signal ? { signal } : {}),
      }, apiAssetSchema);
    },
    getAsset(id: string, signal?: AbortSignal) {
      return request({ method: 'GET', url: `/api/v1/assets/${encodeURIComponent(id)}`,
        ...(signal ? { signal } : {}),
      }, apiAssetSchema);
    },
    async deleteAsset(id: string, idempotencyKey: string, signal?: AbortSignal): Promise<void> {
      input(apiIdempotencyKeySchema, idempotencyKey);
      await request({ method: 'DELETE', url: `/api/v1/assets/${encodeURIComponent(id)}`,
        headers: { 'Idempotency-Key': idempotencyKey },
        ...(signal ? { signal } : {}),
      }, { parse: () => undefined });
    },
    async deleteHall(id: string, expectedRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<void> {
      input(apiIdempotencyKeySchema, idempotencyKey);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new HallApiError('invalid_request', 'Invalid expected revision');
      await request({ method: 'DELETE', url: `/api/v1/halls/${encodeURIComponent(id)}`,
        headers: { 'If-Match': `"${expectedRevision}"`, 'Idempotency-Key': idempotencyKey },
        ...(signal ? { signal } : {}),
      }, { parse: () => undefined });
    },
    getOccurrence(id: string, signal?: AbortSignal): Promise<ApiOccurrence> {
      return request({ method: 'GET', url: `/api/v1/occurrences/${encodeURIComponent(id)}`,
        ...(signal ? { signal } : {}),
      }, apiOccurrenceSchema);
    },
    getSeatMap(id: string, signal?: AbortSignal) {
      return request({ method: 'GET', url: `/api/v1/occurrences/${encodeURIComponent(id)}/seat-map`,
        ...(signal ? { signal } : {}),
      }, apiPublishedLayoutSchema);
    },
    getAvailability(id: string, signal?: AbortSignal) {
      return request({ method: 'GET', url: `/api/v1/occurrences/${encodeURIComponent(id)}/availability`,
        ...(signal ? { signal } : {}),
      }, apiSeatAvailabilitySchema);
    },
    getPrices(id: string, signal?: AbortSignal) {
      return request({ method: 'GET', url: `/api/v1/occurrences/${encodeURIComponent(id)}/prices`,
        ...(signal ? { signal } : {}),
      }, apiSeatPricesSchema);
    },
    async getPricingSegments(id: string, signal?: AbortSignal): Promise<ApiPricingCatalog> {
      const catalog = await request({
        method: 'GET',
        url: `/api/v1/occurrences/${encodeURIComponent(id)}/pricing-segments`,
        ...(signal ? { signal } : {}),
      }, apiPricingCatalogSchema);
      if (catalog.occurrenceId !== id)
        throw new HallApiError('invalid_response', 'Pricing catalog occurrence does not match the request');
      return catalog;
    },
    async getPricingAssignments(id: string, signal?: AbortSignal): Promise<ApiPricingAssignments> {
      const assignments = await request({
        method: 'GET',
        url: `/api/v1/occurrences/${encodeURIComponent(id)}/pricing-assignments`,
        ...(signal ? { signal } : {}),
      }, apiPricingAssignmentsSchema);
      if (assignments.occurrenceId !== id)
        throw new HallApiError('invalid_response', 'Pricing assignments occurrence does not match the request');
      return assignments;
    },
    async savePricingAssignments(
      id: string,
      body: ApiPricingAssignmentsWrite,
      expectedRevision: number,
      idempotencyKey: string,
      signal?: AbortSignal,
    ): Promise<ApiPricingAssignments> {
      input(apiIdempotencyKeySchema, idempotencyKey);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new HallApiError('invalid_request', 'Invalid expected revision');
      const checkedBody = input(apiPricingAssignmentsWriteSchema, body);
      if (checkedBody.occurrenceId !== id)
        throw new HallApiError('invalid_request', 'Pricing assignments occurrence does not match the request');
      const assignments = await request({
        method: 'PUT',
        url: `/api/v1/occurrences/${encodeURIComponent(id)}/pricing-assignments`,
        headers: {
          'If-Match': `"${expectedRevision}"`,
          'Idempotency-Key': idempotencyKey,
        },
        data: checkedBody,
        ...(signal ? { signal } : {}),
      }, apiPricingAssignmentsSchema);
      if (assignments.occurrenceId !== id)
        throw new HallApiError('invalid_response', 'Pricing assignments occurrence does not match the request');
      return assignments;
    },
    async listOccurrences(signal?: AbortSignal): Promise<ApiOccurrence[]> {
      const result = await request({ method: 'GET', url: '/api/v1/occurrences',
        ...(signal ? { signal } : {}),
      }, apiOccurrenceListSchema);
      return result.items;
    },
    async createHold(
      occurrenceId: string,
      selection: readonly ApiSeatSelection[],
      idempotencyKey: string,
      availabilityRevision?: number,
      signal?: AbortSignal,
    ): Promise<ApiHold> {
      input(apiIdempotencyKeySchema, idempotencyKey);
      const body = input(apiHoldRequestSchema, {
        apiVersion: 'v1', selection,
        ...(availabilityRevision === undefined ? {} : { availabilityRevision }),
      });
      return request({
        method: 'POST',
        url: `/api/v1/occurrences/${encodeURIComponent(occurrenceId)}/holds`,
        headers: { 'Idempotency-Key': idempotencyKey },
        data: body,
        ...(signal ? { signal } : {}),
      }, apiHoldSchema);
    },
    getHold(id: string, signal?: AbortSignal): Promise<ApiHold> {
      return request({ method: 'GET', url: `/api/v1/holds/${encodeURIComponent(id)}`,
        ...(signal ? { signal } : {}),
      }, apiHoldSchema);
    },
    async cancelHold(id: string, idempotencyKey: string, signal?: AbortSignal): Promise<void> {
      input(apiIdempotencyKeySchema, idempotencyKey);
      await request({ method: 'DELETE', url: `/api/v1/holds/${encodeURIComponent(id)}`,
        headers: { 'Idempotency-Key': idempotencyKey },
        ...(signal ? { signal } : {}),
      }, { parse: () => undefined });
    },
    async createOrder(holdId: string, idempotencyKey: string, signal?: AbortSignal): Promise<ApiOrder> {
      input(apiIdempotencyKeySchema, idempotencyKey);
      const body = input(apiOrderRequestSchema, { apiVersion: 'v1', holdId });
      return request({ method: 'POST', url: '/api/v1/orders',
        headers: { 'Idempotency-Key': idempotencyKey }, data: body,
        ...(signal ? { signal } : {}),
      }, apiOrderSchema);
    },
    getOrder(id: string, signal?: AbortSignal): Promise<ApiOrder> {
      return request({ method: 'GET', url: `/api/v1/orders/${encodeURIComponent(id)}`,
        ...(signal ? { signal } : {}),
      }, apiOrderSchema);
    },
    async checkoutOrder(id: string, idempotencyKey: string, signal?: AbortSignal): Promise<ApiOrder> {
      input(apiIdempotencyKeySchema, idempotencyKey);
      return request({ method: 'POST', url: `/api/v1/orders/${encodeURIComponent(id)}/checkout`,
        headers: { 'Idempotency-Key': idempotencyKey },
        data: { apiVersion: 'v1' },
        ...(signal ? { signal } : {}),
      }, apiOrderSchema);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      http.interceptors.request.eject(interceptor);
    },
  };
}
