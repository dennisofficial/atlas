const CHANNEL_SUBPROTOCOL = 'atlas.v1'
const BEARER_SUBPROTOCOL_PREFIX = 'bearer.'

// Mirrored from packages/harness/src/cloud/channel-wire.ts — apps/api deliberately depends on
// nothing in-repo, so the wire contract is restated here and the protocol stamp guards drift.
const CHANNEL_PROTOCOL_VERSION = 2

const SESSION_PATH = '/v1/session'
const CONNECT_TIMEOUT_MS = 30_000
const ACCEPT_TIMEOUT_MS = 60_000
const ACCEPT_POLL_MS = 250

export enum EServeFrameKind {
  Ready = 'ready',
  Error = 'error',
  Parked = 'parked',
}

type ServeFrame =
  | { kind: EServeFrameKind.Ready; protocol?: number }
  | { kind: EServeFrameKind.Error; message: string }
  | { kind: EServeFrameKind.Parked }

const decodeServeFrame = (raw: string): ServeFrame | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  switch (record.kind) {
    case EServeFrameKind.Ready: {
      const protocol = record.protocol
      return { kind: EServeFrameKind.Ready, ...(typeof protocol === 'number' ? { protocol } : {}) }
    }
    case EServeFrameKind.Error:
      return {
        kind: EServeFrameKind.Error,
        message: typeof record.message === 'string' ? record.message : 'unknown error',
      }
    case EServeFrameKind.Parked:
      return { kind: EServeFrameKind.Parked }
    default:
      return null
  }
}

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
 * The wire has no ack for a send, and the serve backfills in-flight frames after the greeting, so
 * no frame can prove this message landed. The serve commits a user-said through the control
 * plane's event log before running the turn, and `accepted` polls for that commit — the only
 * honest evidence of delivery.
 */
export type OrchestratorChannel = {
  inject(args: {
    url: string
    token: string
    threadId: string
    text: string
    accepted: () => Promise<boolean>
  }): Promise<void>
}

export const ORCHESTRATOR_CHANNEL = Symbol('ORCHESTRATOR_CHANNEL')

export function createOrchestratorChannel(args?: {
  socketFactory?: ChannelSocketFactory
}): OrchestratorChannel {
  const socketFactory = args?.socketFactory ?? webSocketSocketFactory

  return {
    inject({ url, token, threadId, text, accepted }) {
      return new Promise<void>((resolve, reject) => {
        const protocols = [CHANNEL_SUBPROTOCOL, `${BEARER_SUBPROTOCOL_PREFIX}${token}`]
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

        const probeAcceptance = (): void => {
          void accepted()
            .then((landed) => {
              if (landed) finish()
            })
            .catch(() => undefined)
        }

        const socket = socketFactory({
          url: sessionSocketUrlOf(url),
          protocols,
          handleOpen: () => {
            try {
              socket.send(
                JSON.stringify({
                  kind: 'hello',
                  threadId,
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
            if (frame.kind === EServeFrameKind.Error) {
              fail(`orchestrator serve refused: ${frame.message}`)
              return
            }
            if (frame.kind === EServeFrameKind.Parked) {
              fail('orchestrator serve parked while injecting')
              return
            }
            if (phase !== EChannelPhase.Connecting) return
            if (frame.protocol !== undefined && frame.protocol !== CHANNEL_PROTOCOL_VERSION) {
              fail(
                `orchestrator serve speaks wire protocol ${frame.protocol}, this control plane speaks ${CHANNEL_PROTOCOL_VERSION}`,
              )
              return
            }
            phase = EChannelPhase.WaitingAccept
            armTimer(ACCEPT_TIMEOUT_MS)
            try {
              socket.send(JSON.stringify({ kind: 'send', text }))
            } catch (failure) {
              fail(failure instanceof Error ? failure.message : 'the message failed to send')
              return
            }
            poll = setInterval(probeAcceptance, ACCEPT_POLL_MS)
            probeAcceptance()
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
