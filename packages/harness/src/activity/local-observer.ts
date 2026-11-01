import type { ThreadId } from '@dltech/atlas-core'
import { EPodState, type ReadActivityReply, type WireThread } from '@dltech/atlas-wire'
import type {
  LocalActivityConnection,
  LocalActivityEndpoint,
  LocalActivityInspector,
  OpenLocalActivityConnection,
} from './local-inspection'

export enum ELocalActivityState {
  Available = 'available',
  Unavailable = 'unavailable',
}
export type LocalActivityReading =
  | { activityState: ELocalActivityState.Available; status: NonNullable<WireThread['status']> }
  | { activityState: ELocalActivityState.Unavailable; reason: string }
export type LocalPodStatusReader = {
  prepare(args: { threadId: ThreadId }): Promise<void>
  read(args: {
    threadId: ThreadId
    lastAssistantSeq: number | null
    readSeq?: number | null
  }): Promise<LocalActivityReading>
  close(): void | Promise<void>
}
export type LocalActivityOutcomes = {
  read(args: { threadId: ThreadId }): Promise<ReadActivityReply['observedOutcome']>
  observe(args: { threadId: ThreadId; candidate: ReadActivityReply }): Promise<{
    snapshot: ReadActivityReply
    outcome: ReadActivityReply['observedOutcome']
  }>
}
type Held = {
  endpoint: LocalActivityEndpoint
  connection: LocalActivityConnection
  revision: number
  closed: boolean
  pending?: Promise<Awaited<ReturnType<LocalActivityOutcomes['observe']>>>
}

const MAX_READ_ATTEMPTS = 3

const unavailable = (): LocalActivityReading => ({
  activityState: ELocalActivityState.Unavailable,
  reason: 'Activity unavailable',
})

export function createLocalActivityObserver(args: {
  known(args: { threadId: ThreadId }): Promise<boolean>
  inspector: LocalActivityInspector
  open: OpenLocalActivityConnection
  outcomes: LocalActivityOutcomes
}): LocalPodStatusReader {
  const held = new Map<ThreadId, Held>()
  const inFlight = new Set<Promise<unknown>>()
  const lifetime = new AbortController()
  const closedSignal = new Promise<never>((_, reject) => {
    lifetime.signal.addEventListener('abort', () => reject(new Error('Activity reader closed')), {
      once: true,
    })
  })
  void closedSignal.catch(() => undefined)
  let shutdown: Promise<void> | undefined
  let closed = false
  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise)
    const forget = (): void => {
      inFlight.delete(promise)
    }
    void promise.then(forget, forget)
    return promise
  }
  const discard = (threadId: ThreadId): void => {
    const current = held.get(threadId)
    if (current === undefined || current.closed) return
    current.closed = true
    track(Promise.allSettled([current.pending, current.connection.close()]))
    held.delete(threadId)
  }
  const currentReading = (input: { threadId: ThreadId; current: Held }) => {
    const { threadId, current } = input
    if (current.pending !== undefined) return current.pending
    const run = async () => {
      for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
        const revision = current.revision
        const candidate = await current.connection.read()
        if (closed || current.closed || held.get(threadId) !== current)
          throw new Error('Activity detached')
        if (revision !== current.revision) continue
        const observed = await args.outcomes.observe({ threadId, candidate })
        if (closed || current.closed || held.get(threadId) !== current)
          throw new Error('Activity detached')
        if (revision !== current.revision) continue
        return observed
      }
      throw new Error('Activity changed during observation')
    }
    const pending = track(
      run().finally(() => {
        delete current.pending
      }),
    )
    current.pending = pending
    return pending
  }
  const inspect = async ({ threadId }: { threadId: ThreadId }): Promise<Held | undefined> => {
    if (closed || !(await args.known({ threadId }))) {
      discard(threadId)
      throw new Error('Activity root unavailable')
    }
    const inspected = await Promise.race([
      args.inspector.inspect({ threadId, signal: lifetime.signal }),
      closedSignal,
    ])
    if (closed) throw new Error('Activity reader closed')
    if (inspected.state !== 'running') {
      discard(threadId)
      if (inspected.state === 'unavailable') throw new Error('Activity inspection unavailable')
      return undefined
    }
    const previous = held.get(threadId)
    if (
      previous !== undefined &&
      previous.endpoint.url === inspected.endpoint.url &&
      previous.endpoint.containerId === inspected.endpoint.containerId
    )
      return previous
    discard(threadId)
    let attached: Held | undefined
    let disconnected = false
    const handleInvalidate = (): void => {
      if (attached !== undefined) attached.revision += 1
      queueMicrotask(() => {
        const current = attached
        if (current === undefined || closed || current.closed || held.get(threadId) !== current)
          return
        void currentReading({ threadId, current }).catch(() => undefined)
      })
    }
    const connection = args.open({
      threadId,
      endpoint: inspected.endpoint,
      invalidate: handleInvalidate,
      disconnect: () => {
        disconnected = true
        if (attached !== undefined && held.get(threadId) === attached) discard(threadId)
      },
    })
    const current: Held = { endpoint: inspected.endpoint, closed: false, revision: 0, connection }
    attached = current
    if (disconnected || closed) {
      track(Promise.resolve(connection.close()))
      throw new Error('Activity connection unavailable')
    }
    held.set(threadId, current)
    return current
  }
  return {
    async prepare({ threadId }) {
      try {
        const current = await inspect({ threadId })
        if (current !== undefined) await current.connection.settled()
      } catch (error) {
        discard(threadId)
        throw error
      }
    },
    async read({ threadId, lastAssistantSeq, readSeq }) {
      try {
        const current = await inspect({ threadId })
        if (lastAssistantSeq === null || readSeq === undefined) return unavailable()
        if (current === undefined) {
          const outcome = await track(args.outcomes.read({ threadId }))
          return {
            activityState: ELocalActivityState.Available,
            status: {
              working: false,
              awaiting: null,
              lastOutcome: outcome?.outcome ?? null,
              podState: EPodState.Parked,
              lastAssistantSeq,
              readSeq,
            },
          }
        }
        const { snapshot, outcome } = await currentReading({ threadId, current })
        return {
          activityState: ELocalActivityState.Available,
          status: {
            working: snapshot.working,
            awaiting: snapshot.awaiting,
            lastOutcome: snapshot.working ? null : (outcome?.outcome ?? null),
            podState: EPodState.Running,
            lastAssistantSeq,
            readSeq,
          },
        }
      } catch {
        discard(threadId)
        return unavailable()
      }
    },
    close() {
      if (shutdown !== undefined) return shutdown
      closed = true
      lifetime.abort()
      for (const threadId of held.keys()) discard(threadId)
      shutdown = Promise.allSettled([...inFlight]).then(() => undefined)
      return shutdown
    },
  }
}
