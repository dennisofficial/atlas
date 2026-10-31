import type { ThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'
import { ECloudSandboxState, type CloudSandboxes } from '../cloud/cloud-bridge'

export type LocalActivityEndpoint = { url: string; containerId?: string }
export type LocalActivityInspector = {
  inspect(args: {
    threadId: ThreadId
    signal?: AbortSignal | undefined
  }): Promise<
    | { state: 'not-running' }
    | { state: 'running'; endpoint: LocalActivityEndpoint }
    | { state: 'unavailable'; reason: string }
  >
}
export type LocalActivityConnection = {
  read(): Promise<ReadActivityReply>
  settled(): Promise<void>
  close(): void | Promise<void>
}
export type OpenLocalActivityConnection = (args: {
  threadId: ThreadId
  endpoint: LocalActivityEndpoint
  invalidate: () => void
  disconnect: () => void
}) => LocalActivityConnection

const DEFAULT_INSPECTION_TIMEOUT_MS = 2_000

const abortedRace = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    const handleAbort = (): void => reject(new Error('Activity inspection cancelled'))
    if (signal.aborted) handleAbort()
    else signal.addEventListener('abort', handleAbort, { once: true })
  })

export function createLocalActivityInspector(args: {
  find: CloudSandboxes['find']
  timeoutMs?: number
}): LocalActivityInspector {
  const timeoutMs = args.timeoutMs ?? DEFAULT_INSPECTION_TIMEOUT_MS
  return {
    async inspect({ threadId, signal: caller }) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const cancel = (): void => controller.abort()
      if (caller?.aborted === true) cancel()
      else caller?.addEventListener('abort', cancel, { once: true })
      try {
        if (controller.signal.aborted) throw new Error('Activity inspection cancelled')
        const found = await Promise.race([
          args.find({ threadId, signal: controller.signal }),
          abortedRace(controller.signal),
        ])
        if (found?.state !== ECloudSandboxState.Running) return { state: 'not-running' }
        if (found.url === undefined)
          return { state: 'unavailable', reason: 'Activity endpoint unavailable' }
        const url = new URL(found.url)
        if (
          !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          url.username !== '' ||
          url.password !== ''
        ) {
          return { state: 'unavailable', reason: 'Activity endpoint unavailable' }
        }
        return { state: 'running', endpoint: { url: found.url } }
      } catch {
        return { state: 'unavailable', reason: 'Activity inspection unavailable' }
      } finally {
        clearTimeout(timer)
        caller?.removeEventListener('abort', cancel)
      }
    },
  }
}

export function createCurrentActivityValidator(args: {
  inspector: LocalActivityInspector
  open: OpenLocalActivityConnection
}) {
  const connections = new Set<LocalActivityConnection>()
  const pending = new Set<Promise<ReadActivityReply>>()
  const lifetime = new AbortController()
  let shutdown: Promise<void> | undefined
  let closed = false
  const read = async ({ threadId }: { threadId: ThreadId }): Promise<ReadActivityReply> => {
    if (closed) throw new Error('Activity validator closed')
    const inspected = await args.inspector.inspect({ threadId, signal: lifetime.signal })
    if (closed || inspected.state !== 'running')
      throw new Error('Current activity endpoint unavailable')
    let disconnected = false
    const connection = args.open({
      threadId,
      endpoint: inspected.endpoint,
      invalidate: () => undefined,
      disconnect: () => {
        disconnected = true
      },
    })
    connections.add(connection)
    try {
      const snapshot = await connection.read()
      const current = await args.inspector.inspect({ threadId, signal: lifetime.signal })
      if (
        closed ||
        disconnected ||
        current.state !== 'running' ||
        current.endpoint.url !== inspected.endpoint.url ||
        current.endpoint.containerId !== inspected.endpoint.containerId
      ) {
        throw new Error('Current activity endpoint changed')
      }
      return snapshot
    } finally {
      await connection.close()
      connections.delete(connection)
    }
  }
  const validate = (input: { threadId: ThreadId }): Promise<ReadActivityReply> => {
    const reading = read(input)
    pending.add(reading)
    const forget = (): void => {
      pending.delete(reading)
    }
    void reading.then(forget, forget)
    return reading
  }
  return Object.assign(validate, {
    close() {
      if (shutdown !== undefined) return shutdown
      closed = true
      lifetime.abort()
      const stopping = [...connections].map((connection) => connection.close())
      shutdown = Promise.allSettled([...pending, ...stopping]).then(() => undefined)
      return shutdown
    },
  })
}
