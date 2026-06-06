import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { getCorsOrigins } from '@stockpred/shared-utils';

/**
 * Socket.IO fan-out (spec events):
 *   stock:update, signal:update, prediction:update, trade:update
 * plus pattern:update and notification:new.
 */
@WebSocketGateway({
  cors: { origin: getCorsOrigins(), credentials: true },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private clients = 0;

  handleConnection(_client: Socket): void {
    this.clients += 1;
  }

  handleDisconnect(_client: Socket): void {
    this.clients = Math.max(0, this.clients - 1);
  }

  emit(event: string, payload: unknown): void {
    if (this.clients > 0) {
      this.server.emit(event, payload);
    }
  }
}
