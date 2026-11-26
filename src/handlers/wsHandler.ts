/* Validación, el servidor decide si mandar error sin que se rompa el flujo,
Es no bloqueante, con PROPOSE se ejecuta de forma asincrona,
 mientras dummy json responde, el event loop queda libre para 
 que otros participantes puedan seguir votando en paralelo
 */

 import { WebSocket, WebSocketServer } from 'ws';
import { RoomService } from '../services/roomService.js';
import { ClientMessage, ServerMessage } from '../types/protocol.js';
import { SseManager } from './sseHandler.js';

export function setupWebSocketHandler(
  wss: WebSocketServer,
  roomService: RoomService,
  sseManager: SseManager
): void {
  const send = (ws: WebSocket, message: ServerMessage): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const broadcastWs = (message: ServerMessage): void => {
    const payload = JSON.stringify(message);
    for (const client of roomService.getAllSockets()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  const notifyScreens = (): void => {
    sseManager.broadcast({
      products: roomService.getRankedProducts(),
      participantsCount: roomService.getParticipantsCount(),
    });
  };

  wss.on('connection', (ws: WebSocket) => {
    ws.on('error', () => {
      // Evitar que un error de socket no manejado cierre el servidor
    });

    ws.on('message', async (rawData) => {
      try {
        // Parsear JSON de forma segura
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawData.toString());
        } catch {
          send(ws, { type: 'ERROR', message: 'El mensaje debe ser un JSON válido.' });
          return;
        }

        // Validar estructura base del contrato
        const validation = validateClientMessage(parsed);
        if (!validation.ok) {
          send(ws, { type: 'ERROR', message: validation.error });
          return;
        }

        const msg = validation.message;

        // Procesar acción según el tipo
        if (msg.type === 'JOIN') {
          const result = roomService.join(ws, msg.name);
          if (!result.ok) {
            send(ws, { type: 'ERROR', message: result.error });
            return;
          }

          // Al nuevo participante le mandamos el estado completo
          send(ws, {
            type: 'STATE_SYNC',
            yourName: result.data,
            products: roomService.getRankedProducts(),
            participants: roomService.getParticipantsList(),
          });

          // A todos (incluido él y la pantalla) les avisamos la lista de conectados
          broadcastWs({
            type: 'PARTICIPANTS_UPDATED',
            participants: roomService.getParticipantsList(),
          });
          notifyScreens();
          return;
        }

        // Para cualquier otra acción, el cliente debe haberse identificado primero con JOIN
        const participantName = roomService.getParticipantName(ws);
        if (!participantName) {
          send(ws, { type: 'ERROR', message: 'Debés ingresar un nombre (JOIN) antes de realizar acciones.' });
          return;
        }

        switch (msg.type) {
          case 'PROPOSE': {
            const result = await roomService.proposeProducts(participantName, msg.productIds);
            if (!result.ok) {
              send(ws, { type: 'ERROR', message: result.error });
              return;
            }

            // Solo quien propuso recibe el detalle de agregados y errores individuales
            send(ws, {
              type: 'PROPOSE_RESULT',
              addedIds: result.data.addedIds,
              errors: result.data.errors,
            });

            // Si se agregó al menos un producto, actualizamos a todos y a la pantalla
            if (result.data.listChanged) {
              broadcastWs({
                type: 'LIST_UPDATED',
                products: roomService.getRankedProducts(),
              });
              notifyScreens();
            }
            break;
          }

          case 'VOTE': {
            const result = roomService.vote(participantName, msg.productId);
            if (!result.ok) {
              send(ws, { type: 'ERROR', message: result.error });
              return;
            }
            broadcastWs({
              type: 'LIST_UPDATED',
              products: roomService.getRankedProducts(),
            });
            notifyScreens();
            break;
          }

          case 'UNVOTE': {
            const result = roomService.unvote(participantName, msg.productId);
            if (!result.ok) {
              send(ws, { type: 'ERROR', message: result.error });
              return;
            }
            broadcastWs({
              type: 'LIST_UPDATED',
              products: roomService.getRankedProducts(),
            });
            notifyScreens();
            break;
          }

          case 'REMOVE': {
            const result = roomService.removeProduct(participantName, msg.productId);
            if (!result.ok) {
              send(ws, { type: 'ERROR', message: result.error });
              return;
            }
            broadcastWs({
              type: 'LIST_UPDATED',
              products: roomService.getRankedProducts(),
            });
            notifyScreens();
            break;
          }
        }
      } catch {
        send(ws, { type: 'ERROR', message: 'Ocurrió un error inesperado al procesar el mensaje.' });
      }
    });

    // Limpieza automática al cerrar pestaña o perder conexión
    ws.on('close', () => {
      const { removedName, listChanged } = roomService.leave(ws);
      if (removedName) {
        broadcastWs({
          type: 'PARTICIPANTS_UPDATED',
          participants: roomService.getParticipantsList(),
        });
        if (listChanged) {
          broadcastWs({
            type: 'LIST_UPDATED',
            products: roomService.getRankedProducts(),
          });
        }
        notifyScreens();
      }
    });
  });
}

// VALIDADOR ESTRICTO DEL CONTRATO (TYPE GUARD)

function validateClientMessage(
  data: unknown
): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'El mensaje debe ser un objeto JSON.' };
  }

  const record = data as Record<string, unknown>;
  const type = record.type;

  if (typeof type !== 'string') {
    return { ok: false, error: 'Falta el campo "type" o no es un string.' };
  }

  switch (type) {
    case 'JOIN':
      if (typeof record.name !== 'string') {
        return { ok: false, error: 'El mensaje JOIN requiere un campo "name" de tipo string.' };
      }
      return { ok: true, message: { type: 'JOIN', name: record.name } };

    case 'PROPOSE':
      if (!Array.isArray(record.productIds)) {
        return { ok: false, error: 'El mensaje PROPOSE requiere un arreglo "productIds".' };
      }
      return { ok: true, message: { type: 'PROPOSE', productIds: record.productIds as number[] } };

    case 'VOTE':
      if (typeof record.productId !== 'number' || !Number.isInteger(record.productId) || record.productId <= 0) {
        return { ok: false, error: 'El mensaje VOTE requiere un "productId" entero positivo.' };
      }
      return { ok: true, message: { type: 'VOTE', productId: record.productId } };

    case 'UNVOTE':
      if (typeof record.productId !== 'number' || !Number.isInteger(record.productId) || record.productId <= 0) {
        return { ok: false, error: 'El mensaje UNVOTE requiere un "productId" entero positivo.' };
      }
      return { ok: true, message: { type: 'UNVOTE', productId: record.productId } };

    case 'REMOVE':
      if (typeof record.productId !== 'number' || !Number.isInteger(record.productId) || record.productId <= 0) {
        return { ok: false, error: 'El mensaje REMOVE requiere un "productId" entero positivo.' };
      }
      return { ok: true, message: { type: 'REMOVE', productId: record.productId } };

    default:
      return { ok: false, error: `Tipo de mensaje desconocido: "${type}".` };
  }
}