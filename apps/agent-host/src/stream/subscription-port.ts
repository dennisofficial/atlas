import {
  EStreamErrorCode,
  type EStreamSurface,
  type StreamClientMessage,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

export type StreamSubscriptionMessage = Extract<
  StreamClientMessage,
  { type: 'subscribe' | 'unsubscribe' | 'resnap' }
>

export type SubscriptionConnection = {
  userId: string
  version: number
  surface: EStreamSurface
  send(message: StreamServerMessage): void
  bufferedAmount(): number
  close(code: number): void
}

export type SubscriptionSession = {
  handle(message: StreamSubscriptionMessage): void | Promise<void>
  drain(): void
  close(): void
}

export type SubscriptionPort = {
  open(connection: SubscriptionConnection): SubscriptionSession
}

export const unimplementedSubscriptions: SubscriptionPort = {
  open: (connection) => ({
    handle: (message) => {
      connection.send({ type: 'error', id: message.id, code: EStreamErrorCode.Internal })
    },
    drain: () => undefined,
    close: () => undefined,
  }),
}
