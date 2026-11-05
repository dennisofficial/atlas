import {
  EStreamErrorCode,
  type StreamClientMessage,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

export type StreamSubscriptionMessage = Extract<
  StreamClientMessage,
  { type: 'subscribe' | 'unsubscribe' | 'resnap' }
>

export type SubscriptionPort = {
  handle(args: {
    userId: string
    message: StreamSubscriptionMessage
    send: (message: StreamServerMessage) => void
  }): void | Promise<void>
}

export const unimplementedSubscriptions: SubscriptionPort = {
  handle: ({ message, send }) => {
    send({ type: 'error', id: message.id, code: EStreamErrorCode.Internal })
  },
}
