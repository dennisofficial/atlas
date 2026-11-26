import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'

type Exit = { exitCode: number | null; signal: string | null }

export type McpRequestSettlement =
  | { kind: 'response'; response: unknown }
  | { kind: 'timed-out' }
  | { kind: 'exited'; exit: Exit; stderr: readonly string[] }

export type McpRequestHold = {
  settled: Promise<McpRequestSettlement>
  settle(value: McpRequestSettlement): void
}

type Answer = { id: string; response: unknown }

const answerOf = (line: string): Answer | undefined => {
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined
  const record = message as Record<string, unknown>
  if (record['method'] !== undefined) return undefined
  const id = record['id']
  if (typeof id !== 'string' && typeof id !== 'number') return undefined
  return { id: String(id), response: message }
}

export class McpWaiters {
  private readonly held = new Map<string, McpRequestHold>()

  hold(key: string): McpRequestHold {
    let resolve: (value: McpRequestSettlement) => void = () => undefined
    const settled = new Promise<McpRequestSettlement>((settle) => {
      resolve = settle
    })
    const hold: McpRequestHold = {
      settled,
      settle: (value) => {
        this.held.delete(key)
        resolve(value)
      },
    }
    this.held.set(key, hold)
    return hold
  }

  settleLine(args: { line: string }): void {
    if (this.held.size === 0) return
    const answer = answerOf(args.line)
    if (answer === undefined) return
    this.held.get(answer.id)?.settle({ kind: 'response', response: answer.response })
  }

  end(args: { exit: Exit; stderr: readonly string[] }): void {
    const held = [...this.held.values()]
    this.held.clear()
    for (const hold of held) hold.settle({ kind: 'exited', exit: args.exit, stderr: args.stderr })
  }

  drop(key: string): void {
    this.held.delete(key)
  }
}

export const requestLineOf = (args: { key: string; method: string; params: unknown }): string =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: args.key,
    method: args.method,
    ...(args.params === undefined ? {} : { params: args.params }),
  })

export const cancelLineOf = (args: { key: string; reason: string }): string =>
  JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: args.key, reason: args.reason },
  })

export const requestSettlement = async (args: {
  hold: McpRequestHold
  timeoutMs: number
  signal: AbortSignal
  onTimeout(): void
  onCancel(): void
}): Promise<McpRequestSettlement> => {
  const timer = setTimeout(() => {
    args.onTimeout()
    args.hold.settle({ kind: 'timed-out' })
  }, args.timeoutMs)
  let refuse: (error: Error) => void = () => undefined
  const cancelled = new Promise<never>((_, reject) => {
    refuse = reject
  })
  const handleAbort = (): void => {
    args.onCancel()
    refuse(
      new CallFailureError({
        code: ECallFailure.Cancelled,
        message: 'the mcp request was cancelled',
      }),
    )
  }
  if (args.signal.aborted) handleAbort()
  else args.signal.addEventListener('abort', handleAbort, { once: true })
  try {
    return await Promise.race([args.hold.settled, cancelled])
  } finally {
    clearTimeout(timer)
    args.signal.removeEventListener('abort', handleAbort)
  }
}
