/** Maneja el estado en memoria, las reglas de negocio, el ordenamiento del ranking y la prevención de condiciones de carrera cuando dos personas proponen el mismo id */

import { WebSocket } from 'ws';
import { ProductDTO } from '../types/ProductDTO.js';
import { ProposalErrorItem } from '../types/ProposalErrorItem.js';
import { fetchProductFromCatalog } from './catalogService.js';

interface StoredProduct {
  id: number;
  title: string;
  price: number;
  thumbnail: string;
  proposedBy: string;
  voters: Set<string>;
  createdAt: number;
}

export type ServiceResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export class RoomService {
//Guarda en la RAM del proceso de node

  // Mapa de conexión WebSocket -> nombre del participante
  private participants = new Map<WebSocket, string>();

  // Mapa de productId -> producto en la lista
  private products = new Map<number, StoredProduct>();

  // Control de IDs que actualmente se están consultando al catálogo (evita duplicados concurrentes)
  private pendingProductIds = new Set<number>();

  // GESTIÓN DE PARTICIPANTES

  public join(ws: WebSocket, rawName: string): ServiceResult<string> {
    if (this.participants.has(ws)) {
      return { ok: false, error: 'Ya estás conectado con un nombre.' };
    }

    const cleanName = rawName.trim();

    if (cleanName.length < 2 || cleanName.length > 20) {
      return { ok: false, error: 'El nombre debe tener entre 2 y 20 caracteres.' };
    }

    const normalized = cleanName.toLowerCase();
    for (const existingName of this.participants.values()) {
      if (existingName.toLowerCase() === normalized) {
        return { ok: false, error: `El nombre "${cleanName}" ya está en uso.` };
      }
    }

    this.participants.set(ws, cleanName);
    return { ok: true, data: cleanName };
  }

  public leave(ws: WebSocket): { removedName: string | null; listChanged: boolean } {
    const name = this.participants.get(ws);
    if (!name) {
      return { removedName: null, listChanged: false };
    }

    this.participants.delete(ws);

    // Opcional/limpieza: quitamos los votos del participante que se desconectó
    let listChanged = false;
    for (const product of this.products.values()) {
      if (product.voters.delete(name)) {
        listChanged = true;
      }
    }

    return { removedName: name, listChanged };
  }

  public getParticipantName(ws: WebSocket): string | undefined {
    return this.participants.get(ws);
  }

  public getParticipantsList(): string[] {
    return Array.from(this.participants.values());
  }

  public getParticipantsCount(): number {
    return this.participants.size;
  }

  public getAllSockets(): IterableIterator<WebSocket> {
    return this.participants.keys();
  }

  // PROPUESTA DE PRODUCTOS (ASÍNCRONO)

  public async proposeProducts(
    proposerName: string,
    rawIds: number[]
  ): Promise<ServiceResult<{ addedIds: number[]; errors: ProposalErrorItem[]; listChanged: boolean }>> {
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return { ok: false, error: 'Debés indicar al menos un ID de producto.' };
    }

    if (rawIds.length > 10) {
      return { ok: false, error: 'Podés proponer como máximo 10 productos por vez.' };
    }

    // Validar que todos sean enteros positivos y eliminar duplicados dentro del mismo pedido
    const uniqueIds: number[] = [];
    const seen = new Set<number>();
    for (const id of rawIds) {
      if (!Number.isInteger(id) || id <= 0) {
        return { ok: false, error: `ID inválido: ${String(id)}. Deben ser números enteros positivos.` };
      }
      if (!seen.has(id)) {
        seen.add(id);
        uniqueIds.push(id);
      }
    }

    const errors: ProposalErrorItem[] = [];
    const idsToFetch: number[] = [];

    // Filtro inicial síncrono: descartar los que ya están en lista o en proceso de consulta
    for (const id of uniqueIds) {
      if (this.products.has(id) || this.pendingProductIds.has(id)) {
        errors.push({
          id,
          reason: 'ALREADY_IN_LIST',
          detail: `El producto con ID ${id} ya está en la lista (o se está agregando ahora mismo).`,
        });
      } else {
        this.pendingProductIds.add(id);
        idsToFetch.push(id);
      }
    }

    const addedIds: number[] = [];

    if (idsToFetch.length > 0) {
      try {
        // Consultamos todos los productos válidos en paralelo
        const results = await Promise.all(
          idsToFetch.map((id) => fetchProductFromCatalog(id))
        );

        for (const result of results) {
          if (!result.ok) {
            errors.push(result.error);
            continue;
          }

          const { product } = result;

          // Doble chequeo atómico antes de insertar
          if (this.products.has(product.id)) {
            errors.push({
              id: product.id,
              reason: 'ALREADY_IN_LIST',
              detail: `El producto con ID ${product.id} ya fue agregado por otro participante.`,
            });
            continue;
          }

          this.products.set(product.id, {
            id: product.id,
            title: product.title,
            price: product.price,
            thumbnail: product.thumbnail,
            proposedBy: proposerName,
            voters: new Set<string>(),
            createdAt: Date.now(),
          });

          addedIds.push(product.id);
        }
      } finally {
        // Liberamos siempre los IDs pendientes, haya habido éxito o error
        for (const id of idsToFetch) {
          this.pendingProductIds.delete(id);
        }
      }
    }

    return {
      ok: true,
      data: {
        addedIds,
        errors,
        listChanged: addedIds.length > 0,
      },
    };
  }

  // VOTAR, QUITAR VOTO Y ELIMINAR PRODUCTO

  public vote(participantName: string, productId: number): ServiceResult {
    const product = this.products.get(productId);
    if (!product) {
      return { ok: false, error: 'El producto no existe en la lista.' };
    }

    if (product.voters.has(participantName)) {
      return { ok: false, error: 'Ya votaste este producto.' };
    }

    product.voters.add(participantName);
    return { ok: true, data: undefined };
  }

  public unvote(participantName: string, productId: number): ServiceResult {
    const product = this.products.get(productId);
    if (!product) {
      return { ok: false, error: 'El producto no existe en la lista.' };
    }

    if (!product.voters.delete(participantName)) {
      return { ok: false, error: 'No habías votado este producto.' };
    }

    return { ok: true, data: undefined };
  }

  public removeProduct(participantName: string, productId: number): ServiceResult {
    const product = this.products.get(productId);
    if (!product) {
      return { ok: false, error: 'El producto no existe en la lista.' };
    }

    // Regla definida: solo quien lo propuso puede quitarlo, o cualquiera si tiene 0 votos
    const isOwner = product.proposedBy === participantName;
    const hasNoVotes = product.voters.size === 0;

    if (!isOwner && !hasNoVotes) {
      return {
        ok: false,
        error: `Solo ${product.proposedBy} puede quitar este producto porque ya tiene votos.`,
      };
    }

    this.products.delete(productId);
    return { ok: true, data: undefined };
  }

  // SERIALIZACIÓN Y RANKING

  public getRankedProducts(): ProductDTO[] {
    return Array.from(this.products.values())
      .sort((a, b) => {
        // Primero por cantidad de votos (mayor a menor)
        if (b.voters.size !== a.voters.size) {
          return b.voters.size - a.voters.size;
        }
        // Desempate: el que se propuso primero queda arriba
        return a.createdAt - b.createdAt;
      })
      .map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        thumbnail: p.thumbnail,
        proposedBy: p.proposedBy,
        votesCount: p.voters.size,
        voters: Array.from(p.voters),
      }));
  }
}