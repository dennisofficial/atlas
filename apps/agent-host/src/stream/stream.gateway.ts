import { Inject } from '@nestjs/common'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import type { OnModuleDestroy } from '@nestjs/common'
import type { WebSocket, WebSocketServer as Server } from 'ws'

import { STREAM } from '../host/tokens'
import { frameText, onSocketDrain, streamSocketPort } from './socket-port'
import { STREAM_SOCKET_MAX_PAYLOAD_BYTES, STREAM_SOCKET_PING_MS } from './stream-limits'
import { STREAM_PATH, StreamService } from './stream-service'

@WebSocketGateway({ path: STREAM_PATH, maxPayload: STREAM_SOCKET_MAX_PAYLOAD_BYTES })
export class StreamGateway implements OnModuleDestroy {
  @WebSocketServer()
  server: Server | undefined

  private readonly answered = new WeakSet<WebSocket>()
  private readonly heartbeat: ReturnType<typeof setInterval>

  constructor(@Inject(STREAM) private readonly stream: StreamService) {
    this.heartbeat = setInterval(() => this.ping(), STREAM_SOCKET_PING_MS)
    this.heartbeat.unref?.()
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat)
  }

  handleConnection(client: WebSocket): void {
    const connection = this.stream.open(streamSocketPort(client))
    this.answered.add(client)
    client.on('pong', () => this.answered.add(client))
    client.on('message', (raw) => connection.handleMessage(frameText(raw)))
    client.on('close', () => connection.handleClose())
    onSocketDrain(client, () => connection.handleDrain())
  }

  private ping(): void {
    for (const client of this.server?.clients ?? []) {
      if (!this.answered.delete(client)) {
        client.terminate()
        continue
      }
      client.ping()
    }
  }
}
