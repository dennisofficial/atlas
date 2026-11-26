import type { CallOp, DaemonEvent } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'

import { mcpGroup } from '..'
import type { DaemonOpsDeps } from '../../deps'

export type McpRig = {
  events: DaemonEvent[]
  call(op: CallOp, options?: { key?: string; signal?: AbortSignal }): Promise<unknown>
  lines(serverId: string): string[]
  stop(): Promise<void>
}

const deps: DaemonOpsDeps = { env: { PATH: process.env['PATH'] ?? '' }, home: '/tmp' }

export const mcpRig = (): McpRig => {
  const events: DaemonEvent[] = []
  const group = mcpGroup(deps)({
    publish: (event: DaemonEvent) => void events.push(event),
  } as never)
  return {
    events,
    call: async (op, options = {}) => {
      const registered = group.ops.find((candidate) => candidate.op === op.op)
      if (registered === undefined) throw new Error(`no op ${op.op}`)
      const ctx: CallContext = {
        key: options.key ?? 'k',
        signal: options.signal ?? new AbortController().signal,
        output: () => undefined,
        publish: () => undefined,
      }
      return await registered.run({ op, ctx })
    },
    lines: (serverId) =>
      events.flatMap((event) =>
        event.type === 'mcp.message' && event.serverId === serverId ? [event.line] : [],
      ),
    stop: async () => {
      await group.stop?.()
    },
  }
}

export const waitUntil = async (ready: () => boolean, ms = 3_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the server never answered')
}
