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
import { Events, type ConsultationEndedEvent, type ConsultationMessageEvent } from '../common/events.js';
import { errorMessage, parseWsPayload, socketCorsOrigins, type WsAck } from '../common/ws.js';
import { ConsultationsService } from './consultations.service.js';
import { JoinConsultationDto, SignalDto, SocketMessageDto } from './dto/consultation.dto.js';

const room = (consultationId: string) => `consultation:${consultationId}`;

/**
 * Real-time consultation: chat, and a relay for WebRTC signalling
 * (offer/answer/ICE) between the doctor and the patient. Media itself flows
 * peer-to-peer (configure STUN/TURN in the apps).
 */
// Sockets authenticate with SocketAuthService (handshake token, user re-loaded on every event),
// so the HTTP guards (bearer header, @Can, throttler) are skipped here.
@Public()
@SkipThrottle()
@WebSocketGateway({ namespace: '/consultations', cors: { origin: socketCorsOrigins(), credentials: true } })
export class ConsultationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ConsultationsGateway.name);

  @WebSocketServer()
  private readonly server: Namespace;

  constructor(
    private readonly auth: SocketAuthService,
    private readonly consultations: ConsultationsService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      if (!(await this.auth.authenticate(socket))) socket.disconnect(true);
    } catch (error) {
      this.logger.error(`Socket auth failed: ${errorMessage(error)}`);
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('consultation:join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<WsAck> {
    const parsed = await parseWsPayload(JoinConsultationDto, body);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const user = await this.auth.currentUser(socket);
    if (!user) return { ok: false, error: 'Unauthorized' };
    try {
      const c = await this.consultations.requireParticipant(user, parsed.dto.consultationId);
      if (c.status === 'ENDED') return { ok: false, error: 'This consultation has ended' };
      await socket.join(room(c.id));
      socket.to(room(c.id)).emit('consultation:peer-joined', { userId: user.id });
      return { ok: true, data: { status: c.status } };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  @SubscribeMessage('consultation:message')
  async message(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<WsAck> {
    const parsed = await parseWsPayload(SocketMessageDto, body);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const user = await this.auth.currentUser(socket);
    if (!user) return { ok: false, error: 'Unauthorized' };
    try {
      // Stored, then broadcast to the room through the ConsultationMessage event.
      const m = await this.consultations.sendMessage(user, parsed.dto.consultationId, parsed.dto.body);
      return { ok: true, data: m };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  @SubscribeMessage('webrtc:offer')
  offer(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.relay(socket, 'webrtc:offer', body);
  }

  @SubscribeMessage('webrtc:answer')
  answer(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.relay(socket, 'webrtc:answer', body);
  }

  @SubscribeMessage('webrtc:ice')
  ice(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.relay(socket, 'webrtc:ice', body);
  }

  @OnEvent(Events.ConsultationMessage)
  onMessage(event: ConsultationMessageEvent) {
    this.server.to(room(event.consultationId)).emit('consultation:message', {
      id: event.id,
      consultationId: event.consultationId,
      senderId: event.senderId,
      body: event.body,
      createdAt: event.createdAt,
    });
  }

  @OnEvent(Events.ConsultationEnded)
  onEnded(event: ConsultationEndedEvent) {
    this.server.to(room(event.consultationId)).emit('consultation:ended', { consultationId: event.consultationId });
    this.server.in(room(event.consultationId)).socketsLeave(room(event.consultationId));
  }

  /** Relays signalling only to sockets in a room this socket has joined (i.e. it passed the participant check). */
  private async relay(socket: Socket, event: string, body: unknown): Promise<WsAck> {
    const parsed = await parseWsPayload(SignalDto, body);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const target = room(parsed.dto.consultationId);
    if (!socket.rooms.has(target)) return { ok: false, error: 'Join the consultation first' };
    socket.to(target).emit(event, {
      consultationId: parsed.dto.consultationId,
      from: (socket.data as { userId?: string }).userId,
      data: parsed.dto.data,
    });
    return { ok: true };
  }
}
