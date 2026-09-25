import {
  bearerSubprotocolOf,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  decodeServeFrame,
  EClientFrame,
  EServeFrame,
  encodeFrame,
} from '@dltech/atlas-wire'

const SESSION_PATH = '/v1/session'
const CONNECT_TIMEOUT_MS = 30_000
const ACCEPT_TIMEOUT_MS = 60_000
const ACCEPT_POLL_MS = 250

export const sessionSocketUrlOf = (url: string): string =>
  `${url.replace(/\/+$/, '').replace(/^http/, 'ws')}${SESSION_PATH}`

export type ChannelSocket = {
  send(data: string): void
  close(): void
}

export type ChannelSocketFactory = (args: {
  url: string
  protocols: readonly string[]
  handleOpen: () => void
  handleMessage: (data: string) => void
  handleClose: (code: number, reason: string) => void
  handleError: () => void
}) => ChannelSocket

export const webSocketSocketFactory: ChannelSocketFactory = ({
  url,
  protocols,
  handleOpen,
  handleMessage,
  handleClose,
  handleError,
}) => {
  const socket = new WebSocket(url, [...protocols])
  socket.onopen = () => handleOpen()
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') handleMessage(event.data)
  }
  socket.onclose = (event) => handleClose(event.code, event.reason)
  socket.onerror = () => handleError()
  return { send: (data) => socket.send(data), close: () => socket.close() }
}

export enum EChannelPhase {
  Connecting = 'connecting',
  WaitingAccept = 'waiting-accept',
}

/**
 * The strongest proof of delivery the current wire protocol offers, strongest first. The serve
 * answers a `send` frame only with an error — `EClientRequest` has no commit-and-ack op today —
 * so there is no `ReplyAcked` tier until the protocol grows one. A socket error frame after a
 * possibly-committed send is still possible either way, which is why `Committed` (the durable
 * event-log marker) stays the backstop that makes a retry safe.
 */
export enum EDeliveryProof {
  Committed = 'committed',
  SocketAccepted = 'socket-accepted',
}

export type DeliveryWitness = {
  commitLanded: () => Promise<boolean>
  delivered: (proof: EDeliveryProof) => Promise<void>
}

/**
 * The channel prefers the strongest proof the protocol supports: a commit already in the durable
 * log short-circuits the send entirely (idempotent re-delivery), the socket itself must accept
 * the frame, and the commit marker then confirms propagation. The serve backfills in-flight
 * frames after the greeting, so no received frame can stand in for that commit.
 */
export type OrchestratorChannel = {
  inject(args: {
    url: string
    token: string
    threadId: string
    text: string
    witness: DeliveryWitness
  }): Promise<void>
}

export const ORCHESTRATOR_CHANNEL = Symbol('ORCHESTRATOR_CHANNEL')

export function createOrchestratorChannel(args?: {
  socketFactory?: ChannelSocketFactory
}): OrchestratorChannel {
  const socketFactory = args?.socketFactory ?? webSocketSocketFactory

  return {
    inject({ url, token, threadId, text, witness }) {
      return new Promise<void>((resolve, reject) => {
        const protocols = [CHANNEL_SUBPROTOCOL, bearerSubprotocolOf(token)]
        let phase = EChannelPhase.Connecting
        let settled = false
        let poll: ReturnType<typeof setInterval> | undefined
        let timer: ReturnType<typeof setTimeout> | undefined

        const finish = (failure?: Error): void => {
          if (settled) return
          settled = true
          if (timer !== undefined) clearTimeout(timer)
          if (poll !== undefined) clearInterval(poll)
          socket.close()
          if (failure === undefined) resolve()
          else reject(failure)
        }

        const fail = (message: string): void => finish(new Error(message))

        const armTimer = (ms: number): void => {
          if (timer !== undefined) clearTimeout(timer)
          timer = setTimeout(() => {
            fail(`orchestrator channel timed out in phase ${phase}`)
          }, ms)
        }

        const deliver = (proof: EDeliveryProof): void => {
          void witness
            .delivered(proof)
            .then(() => finish())
            .catch((failure: unknown) => {
              fail(failure instanceof Error ? failure.message : 'the delivery witness failed')
            })
        }

        const probeAcceptance = (): void => {
          void witness
            .commitLanded()
            .then((landed) => {
              if (landed) deliver(EDeliveryProof.Committed)
            })
            .catch(() => undefined)
        }

        const socket = socketFactory({
          url: sessionSocketUrlOf(url),
          protocols,
          handleOpen: () => {
            try {
              socket.send(
                encodeFrame({
                  kind: EClientFrame.Hello,
                  threadId: threadId as never,
                  channelCursor: null,
                  lastEventSeq: 0,
                  protocol: CHANNEL_PROTOCOL_VERSION,
                }),
              )
            } catch (failure) {
              fail(failure instanceof Error ? failure.message : 'the hello frame failed to send')
            }
          },
          handleMessage: (data) => {
            const frame = decodeServeFrame(data)
            if (frame === null) return
            if (frame.kind === EServeFrame.Error) {
              fail(`orchestrator serve refused: ${frame.message}`)
              return
            }
            if (frame.kind === EServeFrame.Parked) {
              fail('orchestrator serve parked while injecting')
              return
            }
            if (frame.kind !== EServeFrame.Ready) return
            if (phase !== EChannelPhase.Connecting) return
            if (frame.protocol !== undefined && frame.protocol !== CHANNEL_PROTOCOL_VERSION) {
              fail(
                `orchestrator serve speaks wire protocol ${frame.protocol}, this control plane speaks ${CHANNEL_PROTOCOL_VERSION}`,
              )
              return
            }
            phase = EChannelPhase.WaitingAccept
            armTimer(ACCEPT_TIMEOUT_MS)
            void witness
              .commitLanded()
              .then((landed) => {
                if (landed) {
                  deliver(EDeliveryProof.Committed)
                  return
                }
                try {
                  socket.send(encodeFrame({ kind: EClientFrame.Send, text }))
                } catch (failure) {
                  fail(failure instanceof Error ? failure.message : 'the message failed to send')
                  return
                }
                deliver(EDeliveryProof.SocketAccepted)
              })
              .catch(() => {
                fail('the delivery witness failed before the send')
              })
          },
          handleClose: (code, reason) => {
            fail(`orchestrator channel closed in phase ${phase} (${code} ${reason})`)
          },
          handleError: () => {
            fail('orchestrator channel reported an error')
          },
        })
        armTimer(CONNECT_TIMEOUT_MS)
      })
    },
  }
}
