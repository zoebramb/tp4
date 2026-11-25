/**Se encarga de consultar DummyJSON con fetch, aplica el tiempo máximo de espera y traduce los errores sin tirar el servidor */

import { config } from '../config.js';
import { ProposalErrorItem } from '../types/ProposalErrorItem.js';

export interface CatalogProductData {
  id: number;
  title: string;
  price: number;
  thumbnail: string;
}

export type CatalogFetchResult =
  | { ok: true; product: CatalogProductData }
  | { ok: false; error: ProposalErrorItem };

export async function fetchProductFromCatalog(id: number): Promise<CatalogFetchResult> {
  const url = new URL(`${config.catalogBaseUrl}/${id}`);
  if (config.catalogDelayMs > 0) {
    url.searchParams.set('delay', String(config.catalogDelayMs));
  }

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(config.catalogTimeoutMs),
    });

    if (response.status === 404) {
      return {
        ok: false,
        error: {
          id,
          reason: 'NOT_FOUND',
          detail: `El producto con ID ${id} no existe en el catálogo.`,
        },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: {
          id,
          reason: 'CATALOG_ERROR',
          detail: `El catálogo respondió con estado HTTP ${response.status}.`,
        },
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (
      typeof data.id !== 'number' ||
      typeof data.title !== 'string' ||
      typeof data.price !== 'number' ||
      typeof data.thumbnail !== 'string'
    ) {
      return {
        ok: false,
        error: {
          id,
          reason: 'CATALOG_ERROR',
          detail: 'Respuesta con formato inesperado desde el catálogo.',
        },
      };
    }

    return {
      ok: true,
      product: {
        id: data.id,
        title: data.title,
        price: data.price,
        thumbnail: data.thumbnail,
      },
    };
  } catch (err: unknown) {
    // AbortSignal.timeout lanza un DOMException con name 'TimeoutError'
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return {
        ok: false,
        error: {
          id,
          reason: 'TIMEOUT',
          detail: `El catálogo tardó más de ${config.catalogTimeoutMs} ms en responder.`,
        },
      };
    }

    return {
      ok: false,
      error: {
        id,
        reason: 'CATALOG_ERROR',
        detail: 'Error de red al intentar comunicarse con el catálogo.',
      },
    };
  }
}