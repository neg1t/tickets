import axios, { type AxiosInstance } from 'axios';
import {
  buyerGeometryChunkSchema,
  buyerGeometryManifestSchema,
  type BuyerGeometryChunk,
  type BuyerGeometryManifest,
} from '@hall-platform/api-contracts';
import { BuyerApiError } from './buyerClient.js';

export type BuyerGeometryClientOptions = Readonly<{
  baseURL: string;
  axiosInstance?: AxiosInstance;
}>;

function geometryFailure(cause: unknown): BuyerApiError {
  if (cause instanceof BuyerApiError) return cause;
  if (axios.isCancel(cause) || (typeof DOMException !== 'undefined' && cause instanceof DOMException && cause.name === 'AbortError')) {
    return new BuyerApiError('cancelled', 'Geometry request cancelled');
  }
  if (axios.isAxiosError(cause)) {
    const status = cause.response?.status;
    return new BuyerApiError(status ? `http_${status}` : 'network_error', status ? `Geometry request failed (${status})` : 'Geometry request failed');
  }
  return new BuyerApiError('invalid_response', 'Geometry response does not match the public contract');
}

async function verifySha256(buffer: ArrayBuffer, expected: string): Promise<boolean> {
  if (!globalThis.crypto?.subtle) throw new BuyerApiError('unsupported_crypto', 'SHA-256 verification is unavailable in this browser');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buffer));
  const actual = `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return actual === expected;
}

/** Reads immutable, public geometry. Block bytes are hash-checked before JSON parsing. */
export function createBuyerGeometryClient(options: BuyerGeometryClientOptions) {
  const http = options.axiosInstance ?? axios.create({ baseURL: options.baseURL });

  return {
    async getManifest(occurrenceId: string, signal?: AbortSignal): Promise<BuyerGeometryManifest> {
      if (!occurrenceId.trim()) throw new BuyerApiError('invalid_request', 'An occurrence ID is required');
      try {
        const response = await http.get<unknown>(
          `/api/v2/buyer/occurrences/${encodeURIComponent(occurrenceId)}/geometry-manifest`,
          signal ? { signal } : undefined,
        );
        const manifest = buyerGeometryManifestSchema.parse(response.data);
        if (manifest.occurrenceId !== occurrenceId) throw new BuyerApiError('invalid_response', 'Geometry manifest belongs to another event time');
        return manifest;
      } catch (cause) {
        throw geometryFailure(cause);
      }
    },

    async getBlock(manifest: BuyerGeometryManifest, blockId: string, signal?: AbortSignal): Promise<BuyerGeometryChunk> {
      const block = manifest.blocks.find((item) => item.id === blockId);
      if (!block) throw new BuyerApiError('not_found', 'Geometry block is not listed in this manifest');
      try {
        const response = await fetch(block.asset.url, {
          ...(signal ? { signal } : {}),
          credentials: 'omit',
          cache: 'force-cache',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new BuyerApiError(`http_${response.status}`, `Geometry block request failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== block.asset.byteLength || bytes.byteLength > 32 * 1024 * 1024) {
          throw new BuyerApiError('invalid_response', 'Geometry block size does not match its manifest');
        }
        if (!(await verifySha256(bytes, block.asset.sha256))) {
          throw new BuyerApiError('invalid_response', 'Geometry block integrity check failed');
        }
        const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        const chunk = buyerGeometryChunkSchema.parse(value);
        if (chunk.occurrenceId !== manifest.occurrenceId || chunk.layoutVersionId !== manifest.layoutVersionId ||
            chunk.blockId !== block.id || chunk.floorId !== block.floorId) {
          throw new BuyerApiError('invalid_response', 'Geometry block does not match its manifest');
        }
        const zoneIds = new Set(manifest.overview.zones.map(({ id }) => id));
        const geometryWithZones = [...chunk.rows, ...chunk.seats, ...chunk.tables];
        if (geometryWithZones.some((entity) => entity.zoneId !== undefined && !zoneIds.has(entity.zoneId))) {
          throw new BuyerApiError('invalid_response', 'Geometry block references a zone missing from its manifest');
        }
        return chunk;
      } catch (cause) {
        throw geometryFailure(cause);
      }
    },
  };
}
