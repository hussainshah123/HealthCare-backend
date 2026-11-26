import { Logger } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { SkipThrottle } from '@nestjs/throttler';
import { WebSocketGateway, WebSocketServer, type OnGatewayConnection } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { SocketAuthService } from '../auth/socket-auth.service.js';
import { errorMessage, socketCorsOrigins } from '../common/ws.js';

export const userRoom = (userId: string) => `user:${userId}`;

/** Each signed-in socket joins its own `user:<id>` room; the server pushes in-app events there. */
// Sockets authenticate with SocketAuthService (handshake token, user re-loaded on every event),
// so the HTTP guards (bearer header, @Can, throttler) are skipped here.
@Public()
@SkipThrottle()
@WebSocketGateway({ namespace: '/notifications', cors: { origin: socketCorsOrigins(), credentials: true } })
export class NotificationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private readonly server: Namespace;

  constructor(private readonly auth: SocketAuthService) {}

  async handleConnection(socket: Socket) {
    try {
      const user = await this.auth.authenticate(socket);
      if (!user) {
        socket.disconnect(true);
        return;
      }
      await socket.join(userRoom(user.id));
    } catch (error) {
      this.logger.error(`Socket auth failed: ${errorMessage(error)}`);
      socket.disconnect(true);
    }
  }

  sendToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }
}
