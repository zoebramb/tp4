import { ProductDTO } from "./ProductDTO.js";
import { ProposalErrorItem } from "./ProposalErrorItem.js";


// MENSAJES: CLIENTE -> SERVIDOR (WebSocket)

export interface JoinMessage {
  type: 'JOIN';
  name: string;
}

export interface ProposeMessage {
  type: 'PROPOSE';
  productIds: number[];
}

export interface VoteMessage {
  type: 'VOTE';
  productId: number;
}

export interface UnvoteMessage {
  type: 'UNVOTE';
  productId: number;
}

export interface RemoveMessage {
  type: 'REMOVE';
  productId: number;
}

export type ClientMessage =
  | JoinMessage
  | ProposeMessage
  | VoteMessage
  | UnvoteMessage
  | RemoveMessage;

// MENSAJES: SERVIDOR -> CLIENTE (WebSocket)

/** Se envía únicamente al participante que acaba de entrar con éxito */
export interface StateSyncMessage {
  type: 'STATE_SYNC';
  yourName: string;
  products: ProductDTO[];
  participants: string[];
}

/** Broadcast a todos los participantes cuando cambia la lista o los votos */
export interface ListUpdatedMessage {
  type: 'LIST_UPDATED';
  products: ProductDTO[];
}

/** Broadcast a todos los participantes cuando entra o sale alguien */
export interface ParticipantsUpdatedMessage {
  type: 'PARTICIPANTS_UPDATED';
  participants: string[];
}

/** Se envía únicamente al participante que propuso productos, detallando éxitos y fallos */
export interface ProposeResultMessage {
  type: 'PROPOSE_RESULT';
  addedIds: number[];
  errors: ProposalErrorItem[];
}

/** Se envía únicamente al emisor cuando un mensaje es inválido o una acción no está permitida */
export interface ErrorMessage {
  type: 'ERROR';
  message: string;
}

export type ServerMessage =
  | StateSyncMessage
  | ListUpdatedMessage
  | ParticipantsUpdatedMessage
  | ProposeResultMessage
  | ErrorMessage;

// EVENTOS: SERVIDOR -> PANTALLA (SSE)

export interface ScreenStateEvent {
  products: ProductDTO[];
  participantsCount: number;
}