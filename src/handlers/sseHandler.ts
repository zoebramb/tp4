//Mantiene un Set<ServerResponse> con todas las pantallas conectadas y limpia automáticamente cada conexión cuando se cierra la pestaña.

import { IncomingMessage, ServerResponse } from 'node:http';
import { ScreenStateEvent } from '../types/protocol.js';

export class SseManager {
  private clients = new Set<ServerResponse>();

  public addClient(req: IncomingMessage, res: ServerResponse, initialState: ScreenStateEvent): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    this.clients.add(res);

    // Enviamos el estado actual ni bien se conecta la pantalla
    this.sendToClient(res, initialState);

    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  public broadcast(state: ScreenStateEvent): void {
    for (const client of this.clients) {
      if (!client.writableEnded) {
        this.sendToClient(client, state);
      } else {
        this.clients.delete(client);
      }
    }
  }

  private sendToClient(res: ServerResponse, data: ScreenStateEvent): void {
    // Formato estándar de SSE: event + data en JSON + doble salto de línea
    res.write(`event: state\ndata: ${JSON.stringify(data)}\n\n`);
  }
}