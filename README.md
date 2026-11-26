# TP4 · Lista compartida de regalo grupal (Node.js + TypeScript)

Aplicación web en tiempo real para proponer y votar productos de un catálogo externo ([DummyJSON](https://dummyjson.com/)) sin base de datos (estado en memoria). Un único servidor HTTP en un solo puerto atiende:

- Las páginas estáticas (`/`, `/screen`, estilos y scripts).
- La comunicación bidireccional de los **participantes** mediante **WebSocket** estándar.
- Las actualizaciones unidireccionales hacia la **pantalla** compartida mediante **Server-Sent Events (SSE)**.

---

## Instalación y ejecución

### Requisitos
- Node.js versión LTS (probado con Node 22).

### Pasos
1. Instalar dependencias:
   ```bash
   npm install
   ```
2. Crear el archivo `.env` a partir de `.env.example` (opcional, existen valores por defecto):
   ```bash
   cp .env.example .env
   ```
3. Ejecutar el servidor:
   - **Modo desarrollo (con `tsx`):**
     ```bash
     npm run dev
     ```
   - **Compilando TypeScript (`tsc`) y ejecutando con Node:**
     ```bash
     npm run build
     npm start
     ```
4. Abrir en el navegador:
   - **Participante:** `http://localhost:3000/` (se pueden abrir varias pestañas o ventanas).
   - **Pantalla compartida (solo lectura):** `http://localhost:3000/screen`.

---

## Configuración y simulación de catálogo lento

Toda la configuración se gestiona por variables de entorno (en `.env` o pasadas por terminal), sin modificar el código:

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto único para HTTP, WebSocket y SSE. |
| `CATALOG_BASE_URL` | `https://dummyjson.com/products` | URL base del catálogo externo. |
| `CATALOG_TIMEOUT_MS` | `3000` | Tiempo máximo de espera (ms) por cada consulta al catálogo. |
| `CATALOG_DELAY_MS` | `0` | Demora artificial (ms) agregada como `?delay=<ms>` en las consultas a DummyJSON. |

### Cómo simular un catálogo lento sin tocar código
- **Catálogo lento pero dentro del timeout** (para comprobar que los demás siguen votando sin bloqueos): configurar `CATALOG_DELAY_MS=2500` y `CATALOG_TIMEOUT_MS=4000` en `.env` (y reiniciar el servidor).
- **Catálogo que excede el timeout** (para comprobar el error `TIMEOUT`): configurar `CATALOG_DELAY_MS=4000` y `CATALOG_TIMEOUT_MS=1500` en `.env` (y reiniciar el servidor).

---

## Contrato de mensajes

Todos los mensajes WebSocket son objetos JSON con un campo discriminador `type`, tipados en TypeScript en `src/types/protocol.ts`. El servidor valida todo lo que recibe; un mensaje malformado o fuera de contrato nunca cierra el servidor y devuelve `ERROR` únicamente a quien lo envió.

### 1. Cliente → Servidor (WebSocket)

| Tipo (`type`) | Campos | Cuándo se envía | Validación en servidor |
| --- | --- | --- | --- |
| `JOIN` | `name: string` | Cuando el participante ingresa su nombre al abrir la app. | `name` debe ser string (luego se valida largo 2–20 y unicidad). No puede hacerse dos veces en el mismo socket. |
| `PROPOSE` | `productIds: number[]` | Cuando el participante propone uno o varios IDs de DummyJSON. | Requiere `JOIN` previo. Entre 1 y 10 IDs, todos enteros positivos (`> 0`). |
| `VOTE` | `productId: number` | Cuando el participante vota un producto de la lista. | Requiere `JOIN` previo. Entero positivo, producto existente en lista y sin voto previo del participante. |
| `UNVOTE` | `productId: number` | Cuando el participante retira su voto de un producto. | Requiere `JOIN` previo. Entero positivo, producto existente y previamente votado por el participante. |
| `REMOVE` | `productId: number` | Cuando el participante solicita quitar un producto de la lista. | Requiere `JOIN` previo. Entero positivo, producto existente y cumplimiento de la regla de permisos. |

### 2. Servidor → Cliente (WebSocket)

| Tipo (`type`) | Alcance | Campos | Cuándo se envía |
| --- | --- | --- | --- |
| `STATE_SYNC` | Solo al emisor | `yourName: string`, `products: ProductDTO[]`, `participants: string[]` | Inmediatamente después de un `JOIN` exitoso, para que quien entra (incluso tarde) reciba el estado completo sin esperar cambios. |
| `PARTICIPANTS_UPDATED` | Broadcast a todos los conectados | `participants: string[]` | Cada vez que un participante entra (`JOIN`) o se desconecta (cierre de pestaña/socket). |
| `LIST_UPDATED` | Broadcast a todos los conectados | `products: ProductDTO[]` | Cada vez que cambia la lista o el ranking (se agregan productos válidos, alguien vota/quita voto, se elimina un producto o se desconecta alguien que tenía votos). |
| `PROPOSE_RESULT` | Solo a quien propuso | `addedIds: number[]`, `errors: ProposalErrorItem[]` | Al finalizar una acción `PROPOSE`, informando qué IDs se agregaron y el detalle de cada fallo individual. |
| `ERROR` | Solo al emisor | `message: string` | Cuando el mensaje no es JSON válido, tiene un `type` desconocido, faltan campos, trae valores fuera de rango o pide una acción no permitida. |

#### Estructuras auxiliares

- **`ProductDTO`**:
  ```json
  {
    "id": 1,
    "title": "Essence Mascara Lash Princess",
    "price": 9.99,
    "thumbnail": "https://cdn.dummyjson.com/...",
    "proposedBy": "Ana",
    "votesCount": 2,
    "voters": ["Ana", "Luis"]
  }
  ```
- **`ProposalErrorItem`**:
  ```json
  {
    "id": 999999,
    "reason": "NOT_FOUND",
    "detail": "El producto con ID 999999 no existe en el catálogo."
  }
  ```
  Valores posibles de `reason`:
  - `NOT_FOUND`: el catálogo devolvió HTTP 404 (producto inexistente).
  - `TIMEOUT`: la consulta al catálogo superó `CATALOG_TIMEOUT_MS`.
  - `ALREADY_IN_LIST`: el producto ya estaba en la lista o se estaba consultando en simultáneo por otra propuesta.
  - `CATALOG_ERROR`: otro error HTTP, respuesta con formato inesperado o fallo de red.

### 3. Servidor → Pantalla (Server-Sent Events en `GET /events`)

La pantalla se suscribe mediante `new EventSource('/events')`. El servidor envía eventos nombrados `state` con el siguiente formato SSE:

```text
event: state
data: {"products":[...],"participantsCount":3}
```

- **Campos**:
  - `products: ProductDTO[]`: ranking completo ya ordenado por votos.
  - `participantsCount: number`: cantidad de participantes conectados actualmente.
- **Cuándo se envía**:
  1. Ni bien la pantalla abre la conexión `GET /events` (estado inicial inmediato).
  2. Cada vez que entra o sale un participante, se agrega o quita un producto, o cambia cualquier voto.

---

## Decisiones de diseño

### Nombres aceptados
- Se aplica `trim()` para descartar espacios sobrantes al inicio y al final.
- Se rechazan nombres vacíos o fuera del rango de **2 a 20 caracteres** para mantener identificadores legibles en la lista y en los votantes.
- Se rechazan **nombres repetidos sin distinguir mayúsculas/minúsculas** (por ejemplo, `"Ana"` y `"ana"` se consideran el mismo nombre), porque el nombre identifica al participante para los votos y permisos de eliminación.

### Productos repetidos y concurrencia
- **Ya en la lista**: se descarta antes de llamar a DummyJSON y se informa al emisor con `reason: "ALREADY_IN_LIST"`, permitiendo que el resto de los IDs válidos del mismo pedido se agreguen con normalidad.
- **Repetidos dentro del mismo pedido** (por ejemplo `[1, 1]`): se deduplican antes de consultar al catálogo para evitar peticiones redundantes.
- **Propuestas simultáneas del mismo producto**: antes de iniciar los `fetch` en paralelo (`Promise.all`), el servidor registra de forma síncrona cada ID en un `Set` de IDs pendientes (`pendingProductIds`) y hace un doble chequeo al momento de insertar en el `Map` de productos. Si dos participantes proponen el mismo ID casi al mismo tiempo, solo el primero lo consulta y lo agrega, y el segundo recibe `ALREADY_IN_LIST`. El bloque `finally` libera siempre los IDs pendientes incluso ante timeouts o errores.
- **Votos simultáneos**: Node.js ejecuta la lógica en memoria en un único hilo del event loop y cada producto almacena votantes en un `Set<string>`, por lo que dos votos recibidos casi al mismo tiempo se procesan secuencialmente de forma atómica y se contabilizan ambos sin perder actualizaciones.

### Regla para quitar productos y manejo de desconexiones
- **Quién puede quitar un producto**: puede quitarlo **quien lo propuso**, o **cualquier participante si todavía tiene 0 votos**. Esta regla (aplicada exclusivamente en el servidor) evita que alguien borre un producto que ya recibió apoyo de otros participantes, pero permite limpiar fácilmente propuestas que nadie votó si su autor se desconectó.
- **Ordenamiento del ranking**: de mayor a menor cantidad de votos; ante empate, queda primero el producto propuesto antes (`createdAt` ascendente).
- **Cierre de pestaña / desconexión**: el servidor elimina al participante de su registro, deja de enviarle mensajes y además retira sus votos de los productos para que el ranking refleje únicamente las preferencias de quienes siguen activos.

### Tiempo máximo de espera del catálogo (`3000 ms`)
- Se eligió **3000 ms (3 segundos)** como valor por defecto (`CATALOG_TIMEOUT_MS=3000`), aplicado por cada petición individual con `AbortSignal.timeout`.
- **Justificación**: 3 segundos es suficiente margen para absorber fluctuaciones normales de latencia de una API pública externa como DummyJSON (que suele responder en 200–600 ms), pero lo bastante acotado como para que un usuario no quede esperando indefinidamente si el catálogo se degrada o cae. Además, al consultar todos los IDs de una propuesta en paralelo (`Promise.all`), el tiempo total del lote no se multiplica por la cantidad de productos (hasta 10), sino que queda acotado al timeout de una sola consulta.

---

## Qué ve cada usuario cuando el catálogo falla o tarda

- **El participante que propuso**:
  - Mientras espera la respuesta del catálogo, ve un aviso no bloqueante (*"Consultando catálogo... podés seguir votando mientras esperás"*) y puede seguir votando o viendo actualizaciones de otros en tiempo real.
  - Al finalizar, recibe únicamente él un mensaje `PROPOSE_RESULT` que detalla qué IDs se agregaron con éxito y qué motivo tuvo cada fallo (`NOT_FOUND`, `TIMEOUT`, `ALREADY_IN_LIST` o `CATALOG_ERROR`).
- **Los demás participantes**:
  - No reciben ningún error ajeno ni sufren demoras o bloqueos: siguen votando, proponiendo y viendo cambios con normalidad.
  - Solo reciben `LIST_UPDATED` si al menos uno de los productos propuestos se agregó efectivamente.
- **La pantalla (`/screen`)**:
  - Nunca recibe mensajes de error ni estados intermedios de carga.
  - Solo recibe un evento SSE `state` actualizado si la lista cambió efectivamente.

---

## WebSocket vs. SSE vs. Polling

### Por qué los participantes usan WebSocket
Los participantes necesitan **comunicación bidireccional en tiempo real**: envían acciones frecuentes al servidor (`JOIN`, `PROPOSE`, `VOTE`, `UNVOTE`, `REMOVE`) y reciben al instante tanto respuestas privadas (`STATE_SYNC`, `PROPOSE_RESULT`, `ERROR`) como broadcasts de cambios ajenos (`LIST_UPDATED`, `PARTICIPANTS_UPDATED`). WebSocket mantiene una única conexión full-duplex persistente que además permite detectar de inmediato el cierre de pestaña (`close`) para actualizar la lista de conectados.

### Por qué la pantalla usa Server-Sent Events (SSE)
La pantalla es un cliente estrictamente **unidireccional (solo lectura)**: nunca envía acciones al servidor, solo muestra el ranking y la cantidad de conectados. SSE funciona sobre HTTP estándar, es más liviano y simple de implementar que WebSocket para este caso, y la API nativa `EventSource` del navegador incluye **reconexión automática** sin código adicional.

### Qué cambiaría si la pantalla usara polling
Si la pantalla consultara periódicamente un endpoint HTTP (por ejemplo cada 2 o 5 segundos con `setInterval` + `fetch`):
1. **Latencia y desincronización**: habría un retraso entre cada voto y su aparición en pantalla igual al intervalo de polling (dejaría de verse inmediato).
2. **Tráfico y carga innecesarios**: la pantalla seguiría haciendo peticiones HTTP repetidas incluso cuando nadie está votando ni proponiendo nada, generando trabajo inútil en el servidor y consumo extra de red.
3. **Compromiso difícil de ajustar**: reducir el intervalo (ej. cada 300 ms) mejora la sensación de inmediatez a costa de multiplicar requests por segundo por cada pantalla conectada; aumentarlo reduce carga pero empeora la experiencia en vivo. Con SSE el servidor solo envía datos cuando realmente ocurre un cambio.

---

## Cómo probar los escenarios del práctico

1. Levantar el servidor (`npm run dev`) y abrir **3 pestañas** en `http://localhost:3000/` (participantes A, B y C) y **1 pestaña** en `http://localhost:3000/screen` (pantalla).
2. **Entrada tardía**: con A y B adentro y productos votados, ingresar como C y verificar que ve toda la lista y los conectados al instante.
3. **Fallo parcial**: proponer `1, 999999, 2`. Los productos `1` y `2` se agregan para todos y la pantalla; solo quien propuso ve el error de `999999` (`NOT_FOUND`).
4. **Catálogo lento sin bloqueos**: configurar `CATALOG_DELAY_MS=2500` y `CATALOG_TIMEOUT_MS=4000` en `.env`, reiniciar, proponer desde A y votar desde B mientras A espera. Para probar `TIMEOUT`, poner `CATALOG_DELAY_MS=4000` y `CATALOG_TIMEOUT_MS=1500`.
5. **Concurrencia**: enviar la misma propuesta de ID desde dos pestañas a la vez (no se duplica) y votar casi en simultáneo desde dos pestañas (se cuentan ambos votos).
6. **Cierre de pestaña**: cerrar la pestaña de un participante y confirmar que desaparece de la lista de conectados y baja el contador en la pantalla.
7. **Mensaje inválido desde la consola del navegador**: abrir DevTools en la pestaña de un participante y ejecutar:
   ```js
   window.ws.send("esto no es json");
   window.ws.send(JSON.stringify({ type: "ACCION_INEXISTENTE" }));
   window.ws.send(JSON.stringify({ type: "VOTE", productId: -5 }));
   ```
   El participante recibe un `ERROR` en pantalla y el servidor continúa funcionando con normalidad.
