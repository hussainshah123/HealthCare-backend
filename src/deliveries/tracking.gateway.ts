import { Logger } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { SkipThrottle } from '@nestjs/throttler';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { SocketAuthService } from '../auth/socket-auth.service.js';
import {
  Events,
  type DeliveryStatusChangedEvent,
  type OrderStatusChangedEvent,
  type RiderLocationUpdatedEvent,
} from '../common/events.js';
import { errorMessage, parseWsPayload, socketCorsOrigins, type WsAck } from '../common/ws.js';
import { DeliveriesService } from './deliveries.service.js';
import { JoinDeliveryDto, SocketLocationDto } from './dto/delivery.dto.js';

const room = (orderId: string) => `order:${orderId}`;

/**
 * Live rider tracking.
 * - Customers (and admins) join `order:<id>` with `delivery:join`; only the order's customer may join.
 * - The assigned rider sends `rider:location`; it is stored and relayed to that room only.
 * - When the delivery ends, everyone is removed from the room: tracking stops.
 */
// Sockets authenticate with SocketAuthService (handshake token, user re-loaded on every event),
// so the HTTP guards (bearer header, @Can, throttler) are skipped here.
@Public()
@SkipThrottle()
@WebSocketGateway({ namespace: '/tracking', cors: { origin: socketCorsOrigins(), credentials: true } })
export class TrackingGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TrackingGateway.name);

  @WebSocketServer()
  private readonly server: Namespace;

  constructor(
    private readonly auth: SocketAuthService,
    private readonly deliveries: DeliveriesService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const user = await this.auth.authenticate(socket);
      if (!user) {
        socket.emit('error', { message: 'Unauthorized' });
        socket.disconnect(true);
      }
    } catch (error) {
      // handleConnection's promise is not awaited by Nest: never let it reject.
      this.logger.error(`Socket auth failed: ${errorMessage(error)}`);
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('delivery:join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<WsAck> {
    const parsed = await parseWsPayload(JoinDeliveryDto, body);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const user = await this.auth.currentUser(socket);
    if (!user) return this.unauthorized(socket);

    const { allowed, lastLocation } = await this.deliveries.canWatch(user, parsed.dto.orderId);
    if (!allowed) return { ok: false, error: 'Tracking is not available for this order' };
    await socket.join(room(parsed.dto.orderId));
    return { ok: true, data: { lastLocation } };
  }

  @SubscribeMessage('delivery:leave')
  async leave(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<WsAck> {
    const parsed = await parseWsPayload(JoinDeliveryDto, body);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    await socket.leave(room(parsed.dto.orderId));
    return { ok: true };
  }

  @SubscribeMessage('rider:location')
  async location(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<WsAck> {
    const parsed = await parseWsPayload(SocketLocationDto, body);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const user = await this.auth.currentUser(socket);
    if (!user) return this.unauthorized(socket);
    if (user.role !== 'RIDER') return { ok: false, error: 'Only riders send locations' };
    try {
      const { deliveryId, ...point } = parsed.dto;
      await this.deliveries.recordLocation(user, deliveryId, point);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  @OnEvent(Events.RiderLocationUpdated)
  onLocation(event: RiderLocationUpdatedEvent) {
    this.server.to(room(event.orderId)).emit('rider:location', {
      orderId: event.orderId,
      lat: event.lat,
      lng: event.lng,
      heading: event.heading,
      speed: event.speed,
      recordedAt: event.recordedAt,
    });
  }

  @OnEvent(Events.OrderStatusChanged)
  onOrderStatus(event: OrderStatusChangedEvent) {
    this.server.to(room(event.orderId)).emit('delivery:status', {
      orderId: event.orderId,
      status: event.status,
    });
  }

  @OnEvent(Events.DeliveryStatusChanged)
  onDeliveryStatus(event: DeliveryStatusChangedEvent) {
    if (event.ended) {
      // Location sharing ends with the delivery.
      this.server.in(room(event.orderId)).socketsLeave(room(event.orderId));
    }
  }

  private unauthorized(socket: Socket): WsAck {
    socket.disconnect(true);
    return { ok: false, error: 'Unauthorized' };
  }
}
