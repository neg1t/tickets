import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import {
  apiIdempotencyKeySchema,
  buyerAvailabilityChangesSchema,
  buyerAvailabilitySchema,
  buyerCheckoutRequestSchema,
  buyerCheckoutResultSchema,
  buyerContactSchema,
  buyerErrorSchema,
  buyerHoldRequestSchema,
  buyerHoldSchema,
  buyerOccurrenceContextSchema,
  buyerOccurrenceListSchema,
  buyerOrderRequestSchema,
  buyerOrderSchema,
  buyerOtpChallengeSchema,
  buyerOtpStartRequestSchema,
  buyerOtpVerifyRequestSchema,
  buyerPricesSchema,
  buyerPublicLayoutSchema,
  buyerQuoteRequestSchema,
  buyerQuoteSchema,
  buyerSessionContactSchema,
  buyerSessionCreateRequestSchema,
  buyerSessionCreateResultSchema,
  buyerSessionResumeSchema,
  buyerTicketListSchema,
  type BuyerAvailability,
  type BuyerAvailabilityChanges,
  type BuyerCheckoutRequest,
  type BuyerCheckoutResult,
  type BuyerContact,
  type BuyerHold,
  type BuyerHoldRequest,
  type BuyerOccurrenceContext,
  type BuyerOccurrenceList,
  type BuyerOrder,
  type BuyerPrices,
  type BuyerPublicLayout,
  type BuyerQuote,
  type BuyerSessionResume,
  type BuyerTicketSummary,
} from '@hall-platform/api-contracts';

export class BuyerApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly currentRevision?: number,
    public readonly retryAfterMs?: number,
    public readonly fieldErrors?: readonly { path: readonly (string | number)[]; message: string }[],
  ) {
    super(message);
    this.name = 'BuyerApiError';
  }
}

export type BuyerApiClientOptions = {
  readonly baseURL: string;
  readonly getSessionCredential?: (purchaseSessionId: string) => string | undefined;
  readonly axiosInstance?: AxiosInstance;
};

type RuntimeSchema<T> = { parse(value: unknown): T };
type Session = { purchaseSessionId: string; signal?: AbortSignal };

function parseInput<T>(schema: RuntimeSchema<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new BuyerApiError('invalid_request', 'Request does not match the buyer API contract');
  }
}

function parseIdempotencyKey(key: string): string {
  return parseInput(apiIdempotencyKeySchema, key);
}

function makeBuyerApiError(error: unknown): BuyerApiError {
  if (error instanceof BuyerApiError) return error;
  if (axios.isCancel(error)) return new BuyerApiError('cancelled', 'Request cancelled');
  if (axios.isAxiosError(error)) {
    const parsed = buyerErrorSchema.safeParse(error.response?.data);
    if (parsed.success) {
      return new BuyerApiError(
        parsed.data.code,
        parsed.data.message,
        parsed.data.currentRevision,
        parsed.data.retryAfterMs,
        parsed.data.fieldErrors,
      );
    }
    return new BuyerApiError(
      error.response ? 'http_error' : 'network_error',
      error.response ? `HTTP ${error.response.status}` : 'Network request failed',
    );
  }
  return new BuyerApiError('invalid_response', 'Response does not match the buyer API contract');
}

export function createBuyerApiClient(options: BuyerApiClientOptions) {
  const http = options.axiosInstance ?? axios.create({ baseURL: options.baseURL });
  let disposed = false;

  const sessionConfig = ({ purchaseSessionId, signal }: Session): Pick<AxiosRequestConfig, 'headers' | 'signal'> => {
    const checkedSessionId = parseInput(buyerSessionCreateResultSchema.shape.purchaseSessionId, purchaseSessionId);
    const credential = options.getSessionCredential?.(checkedSessionId);
    return {
      headers: {
        'X-Purchase-Session-Id': checkedSessionId,
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      ...(signal ? { signal } : {}),
    };
  };

  const idSegment = (value: string) => encodeURIComponent(parseInput(buyerHoldSchema.shape.id, value));
  const sessionMutationConfig = (
    session: Session,
    idempotencyKey: string,
    ifMatch?: number,
  ): Pick<AxiosRequestConfig, 'headers' | 'signal'> => {
    const config = sessionConfig(session);
    return {
      ...config,
      headers: {
        ...config.headers,
        'Idempotency-Key': idempotencyKey,
        ...(ifMatch === undefined ? {} : { 'If-Match': `"${ifMatch}"` }),
      },
    };
  };

  async function request<T>(config: AxiosRequestConfig, schema: RuntimeSchema<T>): Promise<T> {
    if (disposed) throw new BuyerApiError('disposed', 'Buyer API client has been disposed');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await http.request<unknown>(config);
        try {
          return schema.parse(response.data);
        } catch {
          throw new BuyerApiError('invalid_response', 'Response does not match the buyer API contract');
        }
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const retryable = config.method?.toUpperCase() === 'GET' && axios.isAxiosError(error) &&
          !axios.isCancel(error) && (status === undefined || status === 429 || status === 503);
        if (!retryable || attempt === 2 || config.signal?.aborted) throw makeBuyerApiError(error);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            config.signal?.removeEventListener?.('abort', abort);
            resolve();
          }, 50 * (attempt + 1));
          const abort = () => {
            clearTimeout(timer);
            reject(new BuyerApiError('cancelled', 'Request cancelled'));
          };
          config.signal?.addEventListener?.('abort', abort, { once: true });
        });
      }
    }
    throw new BuyerApiError('network_error', 'Request failed after retries');
  }

  async function requestNoContent(config: AxiosRequestConfig): Promise<void> {
    if (disposed) throw new BuyerApiError('disposed', 'Buyer API client has been disposed');
    try {
      const response = await http.request<unknown>(config);
      if (response.status !== 204 || (response.data !== undefined && response.data !== null && response.data !== ''))
        throw new BuyerApiError('invalid_response', 'Expected a 204 response without a body');
    } catch (error) {
      throw makeBuyerApiError(error);
    }
  }

  return {
    async createSession(
      value: { occurrenceId: string; hostBootstrapCredential?: string },
      idempotencyKey: string,
      signal?: AbortSignal,
    ) {
      const key = parseIdempotencyKey(idempotencyKey);
      const body = parseInput(buyerSessionCreateRequestSchema, { apiVersion: 'v2', ...value });
      return request({
        method: 'POST', url: '/api/v2/buyer/sessions',
        headers: { 'Idempotency-Key': key }, data: body,
        ...(signal ? { signal } : {}),
      }, buyerSessionCreateResultSchema);
    },
    resumeSession(purchaseSessionId: string, signal?: AbortSignal): Promise<BuyerSessionResume> {
      return request({
        method: 'GET', url: '/api/v2/buyer/sessions/current/resume',
        ...sessionConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }),
      }, buyerSessionResumeSchema);
    },
    listOccurrences(eventId: string, cursor: string | null, signal?: AbortSignal): Promise<BuyerOccurrenceList> {
      const checkedCursor = parseInput(buyerOccurrenceListSchema.shape.pagination.shape.nextCursor, cursor);
      const params = checkedCursor === null ? undefined : { cursor: checkedCursor };
      return request({ method: 'GET', url: `/api/v2/buyer/events/${idSegment(eventId)}/occurrences`,
        ...(params ? { params } : {}), ...(signal ? { signal } : {}),
      }, buyerOccurrenceListSchema);
    },
    getContext(purchaseSessionId: string, occurrenceId: string, signal?: AbortSignal): Promise<BuyerOccurrenceContext> {
      return request({ method: 'GET', url: `/api/v2/buyer/occurrences/${idSegment(occurrenceId)}/context`,
        ...sessionConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }),
      }, buyerOccurrenceContextSchema);
    },
    getSeatMap(occurrenceId: string, signal?: AbortSignal): Promise<BuyerPublicLayout> {
      return request({ method: 'GET', url: `/api/v2/buyer/occurrences/${idSegment(occurrenceId)}/seat-map`,
        ...(signal ? { signal } : {}),
      }, buyerPublicLayoutSchema);
    },
    getAvailability(occurrenceId: string, signal?: AbortSignal): Promise<BuyerAvailability> {
      return request({ method: 'GET', url: `/api/v2/buyer/occurrences/${idSegment(occurrenceId)}/availability`,
        ...(signal ? { signal } : {}),
      }, buyerAvailabilitySchema);
    },
    getChanges(occurrenceId: string, sinceRevision: number, signal?: AbortSignal): Promise<BuyerAvailabilityChanges> {
      const revision = parseInput(buyerAvailabilityChangesSchema.shape.sinceRevision, sinceRevision);
      return request({ method: 'GET', url: `/api/v2/buyer/occurrences/${idSegment(occurrenceId)}/availability-changes`,
        params: { sinceRevision: revision }, ...(signal ? { signal } : {}),
      }, buyerAvailabilityChangesSchema);
    },
    getPrices(occurrenceId: string, signal?: AbortSignal): Promise<BuyerPrices> {
      return request({ method: 'GET', url: `/api/v2/buyer/occurrences/${idSegment(occurrenceId)}/prices`,
        ...(signal ? { signal } : {}),
      }, buyerPricesSchema);
    },
    async createHold(
      purchaseSessionId: string,
      occurrenceId: string,
      value: BuyerHoldRequest,
      idempotencyKey: string,
      signal?: AbortSignal,
    ): Promise<BuyerHold> {
      const key = parseIdempotencyKey(idempotencyKey);
      const body = parseInput(buyerHoldRequestSchema, value);
      return request({
        method: 'POST', url: `/api/v2/buyer/occurrences/${idSegment(occurrenceId)}/holds`,
        ...sessionMutationConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }, key),
        data: body,
      }, buyerHoldSchema);
    },
    getHold(purchaseSessionId: string, holdId: string, signal?: AbortSignal): Promise<BuyerHold> {
      return request({ method: 'GET', url: `/api/v2/buyer/holds/${idSegment(holdId)}`,
        ...sessionConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }),
      }, buyerHoldSchema);
    },
    async cancelHold(purchaseSessionId: string, holdId: string, expectedRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<void> {
      const key = parseIdempotencyKey(idempotencyKey);
      const revision = parseInput(buyerHoldSchema.shape.revision, expectedRevision);
      return requestNoContent({ method: 'DELETE', url: `/api/v2/buyer/holds/${idSegment(holdId)}`,
        ...sessionMutationConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }, key, revision),
      });
    },
    async saveContact(purchaseSessionId: string, contact: BuyerContact, contactRevision: number, idempotencyKey: string, signal?: AbortSignal) {
      const key = parseIdempotencyKey(idempotencyKey);
      const body = parseInput(buyerContactSchema, contact);
      const revision = parseInput(buyerSessionContactSchema.shape.contactRevision, contactRevision);
      return request({ method: 'PUT', url: '/api/v2/buyer/sessions/current/contact',
        ...sessionMutationConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }, key),
        data: { apiVersion: 'v2', contact: body, contactRevision: revision },
      }, buyerSessionContactSchema);
    },
    async requestEmail(purchaseSessionId: string, email: string, idempotencyKey: string, signal?: AbortSignal) {
      const key = parseIdempotencyKey(idempotencyKey);
      const body = parseInput(buyerOtpStartRequestSchema, { apiVersion: 'v2', email });
      return request({ method: 'POST', url: '/api/v2/buyer/sessions/current/email-challenges',
        ...sessionMutationConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }, key), data: body,
      }, buyerOtpChallengeSchema);
    },
    async verifyEmail(purchaseSessionId: string, challengeId: string, code: string, idempotencyKey: string, signal?: AbortSignal) {
      const key = parseIdempotencyKey(idempotencyKey);
      const body = parseInput(buyerOtpVerifyRequestSchema, { apiVersion: 'v2', code });
      return request({ method: 'POST', url: `/api/v2/buyer/email-challenges/${idSegment(challengeId)}/verify`,
        ...sessionMutationConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }, key), data: body,
      }, buyerSessionContactSchema);
    },
    async createOrder(purchaseSessionId: string, holdId: string, contactRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerOrder> {
      const key = parseIdempotencyKey(idempotencyKey);
      const body = parseInput(buyerOrderRequestSchema, { apiVersion: 'v2', holdId, contactRevision });
      return request({ method: 'POST', url: '/api/v2/buyer/orders',
        ...sessionMutationConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }, key), data: body,
      }, buyerOrderSchema);
    },
    getOrder(purchaseSessionId: string, orderId: string, signal?: AbortSignal): Promise<BuyerOrder> {
      return request({ method: 'GET', url: `/api/v2/buyer/orders/${idSegment(orderId)}`,
        ...sessionConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }),
      }, buyerOrderSchema);
    },
    async createQuote(purchaseSessionId: string, orderId: string, orderRevision: number, promoCode: string | null | undefined, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerQuote> {
      const key = parseIdempotencyKey(idempotencyKey);
      const body = parseInput(buyerQuoteRequestSchema, {
        apiVersion: 'v2', orderRevision,
        ...(promoCode === undefined ? {} : { promoCode }),
      });
      return request({ method: 'POST', url: `/api/v2/buyer/orders/${idSegment(orderId)}/quotes`,
        ...sessionMutationConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }, key), data: body,
      }, buyerQuoteSchema);
    },
    async checkout(purchaseSessionId: string, orderId: string, value: BuyerCheckoutRequest, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerCheckoutResult> {
      const key = parseIdempotencyKey(idempotencyKey);
      const body = parseInput(buyerCheckoutRequestSchema, value);
      return request({ method: 'POST', url: `/api/v2/buyer/orders/${idSegment(orderId)}/checkout`,
        ...sessionMutationConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }, key), data: body,
      }, buyerCheckoutResultSchema);
    },
    getTickets(purchaseSessionId: string, orderId: string, signal?: AbortSignal): Promise<BuyerTicketSummary[]> {
      return request({ method: 'GET', url: `/api/v2/buyer/orders/${idSegment(orderId)}/tickets`,
        ...sessionConfig({ purchaseSessionId, ...(signal ? { signal } : {}) }),
      }, buyerTicketListSchema).then(({ items }) => items);
    },
    dispose() { disposed = true; },
  };
}
