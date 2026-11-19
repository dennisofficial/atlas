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

import { ETerminalOp, type TerminalProblem } from './terminal-model'

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
  onProblem: (problem: TerminalProblem | undefined) => void
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

const PARKED_REASONS: readonly TerminalStreamClose[] = ['asleep']

const UNREACHABLE = "couldn't reach the session — retrying"

const messageOf = (failure: unknown): string => {
  const message = failure instanceof Error ? failure.message : undefined
  return message === undefined || message.length === 0 ? UNREACHABLE : message
}

export function createTerminalTransport(args: TerminalTransportArgs): TerminalTransport {
  const { sessionId, api } = args
  const offsets = new Map<string, number>()
  let subscription: TerminalStreamSubscription | undefined
  let token: symbol | undefined
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()
  const buffered = new Map<string, string>()
  const writing = new Set<string>()

  const report = (op: ETerminalOp, failure: unknown): void =>
    args.onProblem({ op, message: messageOf(failure) })

  const enqueue = (op: ETerminalOp, run: () => Promise<unknown>): void => {
    queue = queue.then(run).then(
      () => args.onProblem(undefined),
      (failure: unknown) => report(op, failure),
    )
  }

  const flush = (terminalId: string): void => {
    if (writing.has(terminalId)) return
    const data = buffered.get(terminalId)
    if (data === undefined) return
    buffered.delete(terminalId)
    writing.add(terminalId)
    enqueue(ETerminalOp.Write, () =>
      api.write({ sessionId, terminalId, data }).finally(() => {
        writing.delete(terminalId)
        if (!disposed) flush(terminalId)
      }),
    )
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

  const dropStream = (failure?: unknown): void => {
    args.onProblem({ op: ETerminalOp.Stream, message: messageOf(failure) })
    args.onLink(ETerminalConnection.Paused)
    closeSubscription()
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
      args.onProblem(undefined)
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
    if (frame.type !== 'closed') {
      dropStream()
      return
    }
    args.onClosed(frame.reason)
    closeSubscription()
    if (frame.reason !== 'restarted' && PARKED_REASONS.includes(frame.reason)) {
      args.onLink(ETerminalConnection.Disconnected)
      return
    }
    args.onLink(
      frame.reason === 'restarted' ? ETerminalConnection.Connecting : ETerminalConnection.Paused,
    )
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
    open: async (open) => {
      const opened = await api
        .open({ sessionId, ...open, ...(open.cwd === undefined ? {} : { cwd: open.cwd }) })
        .then(
          (result) => {
            args.onProblem(undefined)
            return result
          },
          (failure: unknown) => {
            report(ETerminalOp.Open, failure)
            throw failure
          },
        )
      return opened
    },
    write: (terminalId, data) => {
      buffered.set(terminalId, (buffered.get(terminalId) ?? '') + data)
      flush(terminalId)
    },
    resize: (terminalId, cols, rows) =>
      enqueue(ETerminalOp.Resize, () => api.resize({ sessionId, terminalId, cols, rows })),
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
          onError: (failure) => {
            if (stillCurrent()) dropStream(failure)
          },
          onComplete: () => {
            if (stillCurrent()) dropStream()
          },
        },
      )
    },
    dispose: () => {
      disposed = true
      buffered.clear()
      closeSubscription()
    },
  }
}
