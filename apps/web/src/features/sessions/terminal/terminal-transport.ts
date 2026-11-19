import {
  terminalStreamFrameSchema,
  type TerminalListInput,
  type TerminalListOutput,
  type TerminalMutationOutput,
  type TerminalOpenInput,
  type TerminalOpenOutput,
  type TerminalReadInput,
  type TerminalReadOutput,
  type TerminalRenameInput,
  type TerminalResizeInput,
  type TerminalRow,
  type TerminalStreamAttachInput,
  type TerminalWriteInput,
} from '@dltech/atlas-protocol'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

export type TerminalCursor = { terminalId: string; offset: number }

export type TerminalStreamSubscription = { unsubscribe(): void }

export type TerminalStreamHandlers = {
  onData: (value: unknown) => void
  onError: (failure: unknown) => void
  onComplete: () => void
}

export type TerminalApi = {
  list: (input: TerminalListInput) => Promise<TerminalListOutput>
  open: (input: TerminalOpenInput) => Promise<TerminalOpenOutput>
  rename: (input: TerminalRenameInput) => Promise<TerminalMutationOutput>
  write: (input: TerminalWriteInput) => Promise<TerminalMutationOutput>
  resize: (input: TerminalResizeInput) => Promise<TerminalMutationOutput>
  close: (input: { sessionId: string; terminalId: string }) => Promise<TerminalMutationOutput>
  read: (input: TerminalReadInput) => Promise<TerminalReadOutput>
}

export type TerminalStreamClose = 'asleep' | 'restarted' | 'detached'

export type TerminalTransportArgs = {
  sessionId: string
  api: TerminalApi
  subscribe: (
    input: TerminalStreamAttachInput,
    handlers: TerminalStreamHandlers,
  ) => TerminalStreamSubscription
  onOutput: (frame: { terminalId: string; offset: number; data: Uint8Array }) => void
  onExit: (frame: { terminalId: string; exitCode: number | null; signal: string | null }) => void
  onClosed: (reason: TerminalStreamClose) => void
  onLink: (state: ETerminalConnection) => void
}

export type TerminalTransport = {
  list: () => Promise<TerminalRow[]>
  open: (args: {
    cols: number
    rows: number
    cwd?: string | undefined
  }) => Promise<TerminalOpenOutput>
  write: (terminalId: string, data: string) => void
  resize: (terminalId: string, cols: number, rows: number) => void
  close: (terminalId: string) => Promise<void>
  rename: (terminalId: string, name: string) => Promise<void>
  read: (terminalId: string, offset: number) => Promise<TerminalReadOutput>
  reconnect: (cursors: readonly TerminalCursor[]) => void
  dispose: () => void
}

export function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const isFrameStream = (value: unknown): value is AsyncIterable<unknown> =>
  typeof (value as { [Symbol.asyncIterator]?: unknown } | null)?.[Symbol.asyncIterator] ===
  'function'

const DISCONNECTING_REASONS: readonly TerminalStreamClose[] = ['asleep', 'detached']

export function createTerminalTransport(args: TerminalTransportArgs): TerminalTransport {
  const { sessionId, api } = args
  const offsets = new Map<string, number>()
  let subscription: TerminalStreamSubscription | undefined
  let token: symbol | undefined
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()

  const enqueue = (run: () => Promise<unknown>): void => {
    queue = queue.then(run).catch(() => undefined)
  }

  const cursorOf = (terminalId: string): number => offsets.get(terminalId) ?? 0

  const advance = (terminalId: string, offset: number, length: number): void => {
    const next = offset + length
    if (next > cursorOf(terminalId)) offsets.set(terminalId, next)
  }

  const closeSubscription = (): void => {
    subscription?.unsubscribe()
    subscription = undefined
    token = undefined
  }

  const catchUp = async (terminalId: string): Promise<void> => {
    const offset = cursorOf(terminalId)
    const result = await api.read({ sessionId, terminalId, offset })
    if (disposed) return
    const data = bytesOf(result.data)
    if (data.length > 0) args.onOutput({ terminalId, offset: result.offset, data })
    advance(terminalId, result.offset, data.length)
    if (result.exited !== null) args.onExit({ terminalId, ...result.exited })
  }

  const handleFrame = (frame: ReturnType<typeof terminalStreamFrameSchema.parse>): void => {
    if (frame.type === 'ready') {
      args.onLink(ETerminalConnection.Connected)
      return
    }
    if (frame.type === 'output') {
      const data = bytesOf(frame.data)
      args.onOutput({ terminalId: frame.terminalId, offset: frame.offset, data })
      advance(frame.terminalId, frame.offset, data.length)
      return
    }
    if (frame.type === 'gap') {
      void catchUp(frame.terminalId)
      return
    }
    if (frame.type === 'exit') {
      args.onExit({ terminalId: frame.terminalId, exitCode: frame.exitCode, signal: frame.signal })
      return
    }
    if (frame.type === 'parked') {
      args.onLink(ETerminalConnection.Disconnected)
      closeSubscription()
      return
    }
    args.onClosed(frame.reason)
    args.onLink(
      frame.reason === 'restarted'
        ? ETerminalConnection.Connecting
        : ETerminalConnection.Disconnected,
    )
    if (DISCONNECTING_REASONS.includes(frame.reason)) closeSubscription()
  }

  const handleValue = (value: unknown): void => {
    if (disposed) return
    const parsed = terminalStreamFrameSchema.safeParse(value)
    if (parsed.success) handleFrame(parsed.data)
  }

  const pump = (frames: AsyncIterable<unknown>): void => {
    void (async () => {
      for await (const frame of frames) {
        if (disposed) return
        handleValue(frame)
      }
    })()
  }

  return {
    list: async () => (await api.list({ sessionId })).terminals,
    open: async (open) =>
      api.open({ sessionId, ...open, ...(open.cwd === undefined ? {} : { cwd: open.cwd }) }),
    write: (terminalId, data) => enqueue(() => api.write({ sessionId, terminalId, data })),
    resize: (terminalId, cols, rows) =>
      enqueue(() => api.resize({ sessionId, terminalId, cols, rows })),
    close: async (terminalId) => {
      await api.close({ sessionId, terminalId })
    },
    rename: async (terminalId, name) => {
      await api.rename({ sessionId, terminalId, name })
    },
    read: (terminalId, offset) => api.read({ sessionId, terminalId, offset }),
    reconnect: (cursors) => {
      for (const cursor of cursors) offsets.set(cursor.terminalId, cursor.offset)
      closeSubscription()
      if (disposed) return
      args.onLink(ETerminalConnection.Connecting)
      const opened = Symbol('terminal-stream')
      token = opened
      const stillCurrent = (): boolean => token === opened && !disposed
      subscription = args.subscribe(
        { sessionId, cursors: cursors.map((cursor) => ({ ...cursor })) },
        {
          onData: (value) => (isFrameStream(value) ? pump(value) : handleValue(value)),
          onError: () => {
            if (stillCurrent()) args.onLink(ETerminalConnection.Paused)
          },
          onComplete: () => {
            if (stillCurrent()) args.onLink(ETerminalConnection.Paused)
          },
        },
      )
    },
    dispose: () => {
      disposed = true
      closeSubscription()
    },
  }
}
