import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { RoomService } from './services/roomService.js';
import { SseManager } from './handlers/sseHandler.js';
import { setupWebSocketHandler } from './handlers/wsHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const roomService = new RoomService();
const sseManager = new SseManager();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Endpoint Server-Sent Events (SSE) para la pantalla
  if (req.method === 'GET' && pathname === '/events') {
    sseManager.addClient(req, res, {
      products: roomService.getRankedProducts(),
      participantsCount: roomService.getParticipantsCount(),
    });
    return;
  }

  // Servir archivos estáticos de /public
  if (req.method === 'GET') {
    let relativeFile = 'index.html';
    if (pathname === '/screen') {
      relativeFile = 'screen.html';
    } else if (pathname !== '/') {
      relativeFile = pathname.replace(/^\/+/, '');
    }

    const filePath = path.resolve(PUBLIC_DIR, relativeFile);

    // Prevenir acceso fuera de /public
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acceso denegado');
      return;
    }

    try {
      const content = await readFile(filePath);
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Archivo no encontrado');
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Método no permitido');
});

// Conectar WebSocketServer al mismo servidor HTTP (mismo puerto)
const wss = new WebSocketServer({ server: httpServer });
setupWebSocketHandler(wss, roomService, sseManager);

httpServer.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  console.log(`Vista Participante: http://localhost:${config.port}/`);
  console.log(`Vista Pantalla:     http://localhost:${config.port}/screen`);
  console.log(`Catálogo:           ${config.catalogBaseUrl} (timeout: ${config.catalogTimeoutMs}ms, delay: ${config.catalogDelayMs}ms)`);
})