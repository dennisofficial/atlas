import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import {
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventLogPort,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  EChannelConnection,
  RemoteTurnRunner,
  type ChannelConnection,
  type ChannelReady,
  type TurnLedgerPort,
} from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'
import { createThreadViewRefresh, driveThreadViewExternally, type ThreadViewRefresh } from '../thread-view-refresh'
import { EThreadRows } from '../use-thread-view'
import type { ConversationStore } from '../../store'

const ROOT = toThreadId('cloud-root')
const CHILD = toThreadId('cloud-child')

const eventOf = (args: { threadId: ThreadId; seq: number; text: string }): Event => ({
  id: toEventId(`${args.threadId}-${args.seq}`),
  threadId: args.threadId,
  runId: toRunId('run-1'),
  seq: args.seq,
  depth: 0,
  at: new Date(args.seq).toISOString(),
  type: 'assistant-said',
  parts: [{ type: 'text', text: args.text }],
})

const stubLog = (served: Map<ThreadId, Event[]>): EventLogPort => {
  const window = (args: { threadId: ThreadId; fromSeq?: number; upTo?: number }) =>
    Promise.resolve(
      (served.get(args.threadId) ?? []).filter(
        (event) =>
          event.seq > (args.fromSeq ?? 0) &&
          (args.upTo === undefined || event.seq <= args.upTo),
      ),
    )

  return {
    append: () => Promise.reject(new Error('read-only stub')),
    replace: () => Promise.reject(new Error('read-only stub')),
    read: window,
    refresh: () => Promise.resolve(),
    head: ({ threadId }) => Promise.resolve(served.get(threadId)?.at(-1)?.seq ?? 0),
    readOwn: window,
  } as EventLogPort
}

const stubLedger = {
  forThreadTree: () => Promise.resolve({ own: [], delegated: [] }),
  forThread: () => Promise.resolve([]),
} as unknown as TurnLedgerPort

const stubChannelFor = (args: { connection: ChannelConnection }) => ({
  channel: {
    threadId: ROOT,
    connection: () => args.connection,
    onReady: () => () => undefined,
    subscribe: () => () => undefined,
  },
})

const OPEN: ChannelConnection = { state: EChannelConnection.Open, detail: null }

const cloudAppFor = (args: {
  connection: ChannelConnection
  served: Map<ThreadId, Event[]>
}): { app: AtlasApp } => ({
  app: {
    runner: Object.create(RemoteTurnRunner.prototype) as RemoteTurnRunner,
    channel: stubChannelFor({ connection: args.connection }).channel,
    log: stubLog(args.served),
    ledger: stubLedger,
  } as unknown as AtlasApp,
})

const refreshOf = (args: {
  app: AtlasApp
  threadId: ThreadId
  setEvents?: (next: readonly Event[]) => void
}): ThreadViewRefresh =>
  createThreadViewRefresh({
    app: args.app,
    threadId: args.threadId,
    rows: EThreadRows.Own,
    effects: () => undefined,
    store: {
      resetLog: () => undefined,
      setEvents: () => undefined,
    } as unknown as ConversationStore,
    setEvents: args.setEvents ?? (() => undefined),
    heldEvents: () => [],
    readSeed: undefined,
  })

describe('drivesExternally', () => {
  it('is false for a local thread, whose channel carries its signals', () => {
    const refresh = refreshOf({
      app: {
        runner: {},
        channel: { subscribe: () => () => undefined },
      } as unknown as AtlasApp,
      threadId: CHILD,
    })
    expect(refresh.drivesExternally()).toBe(false)
  })

  it('is false for the cloud root thread, whose channel carries its signals', () => {
    const { app } = cloudAppFor({ connection: OPEN, served: new Map() })
    const refresh = refreshOf({ app, threadId: ROOT })
    expect(refresh.drivesExternally()).toBe(false)
  })

  it('is true for a cloud child thread, whose signals the channel silently drops', () => {
    const { app } = cloudAppFor({ connection: OPEN, served: new Map() })
    const refresh = refreshOf({ app, threadId: CHILD })
    expect(refresh.drivesExternally()).toBe(true)
  })
})

describe('a cloud child thread refresh', () => {
  let served: Map<ThreadId, Event[]>
  let app: AtlasApp
  let applied: readonly Event[]

  beforeEach(() => {
    served = new Map([[CHILD, [eventOf({ threadId: CHILD, seq: 1, text: 'first' })]]])
    app = cloudAppFor({ connection: OPEN, served }).app
    applied = []
  })

  const drive = () =>
    refreshOf({ app, threadId: CHILD, setEvents: (next) => (applied = next) })

  it('reads the child transcript the serve answers for', async () => {
    await drive().refresh()
    expect(applied.map((event) => event.seq)).toEqual([1])
  })

  it('re-reads after the served log moves', async () => {
    const refresh = drive()
    await refresh.refresh()
    served.set(CHILD, [
      ...(served.get(CHILD) ?? []),
      eventOf({ threadId: CHILD, seq: 2, text: 'second' }),
    ])

    await refresh.refresh()
    expect(applied.map((event) => event.seq)).toEqual([1, 2])
  })

  it('does not re-apply an unchanged transcript', async () => {
    let resets = 0
    const refresh = createThreadViewRefresh({
      app,
      threadId: CHILD,
      rows: EThreadRows.Own,
      effects: () => undefined,
      store: {
        resetLog: () => (resets += 1),
        setEvents: () => undefined,
      } as unknown as ConversationStore,
      setEvents: () => undefined,
      heldEvents: () => [],
      readSeed: undefined,
    })
    await refresh.refresh()
    await refresh.refresh()
    expect(resets).toBe(1)
  })
})

const PARKED: ChannelConnection = { state: EChannelConnection.Parked, detail: 'idle' }

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

const controllableChannelFor = (args: { connection: ChannelConnection }) => {
  const readyListeners = new Set<() => void>()
  const state = { current: args.connection }
  const channel = {
    threadId: ROOT,
    connection: () => state.current,
    onReady: (listener: (ready: ChannelReady) => void) => {
      const bare = () => listener({} as ChannelReady)
      readyListeners.add(bare)
      return () => {
        readyListeners.delete(bare)
      }
    },
    subscribe: () => () => undefined,
  }
  return { channel, state, emitReady: () => [...readyListeners].forEach((fire) => fire()) }
}

describe('driveThreadViewExternally', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('refreshes when the channel readies, and stops once disposed', async () => {
    const served = new Map<ThreadId, Event[]>([
      [CHILD, [eventOf({ threadId: CHILD, seq: 1, text: 'first' })]],
    ])
    const control = controllableChannelFor({ connection: OPEN })
    const app = {
      runner: Object.create(RemoteTurnRunner.prototype) as RemoteTurnRunner,
      channel: control.channel,
      log: stubLog(served),
      ledger: stubLedger,
    } as unknown as AtlasApp
    let applied: readonly Event[] = []
    const viewRefresh = refreshOf({
      app,
      threadId: CHILD,
      setEvents: (next) => (applied = next),
    })

    const dispose = driveThreadViewExternally({
      cloudChannel: control.channel as never,
      viewRefresh,
    })
    expect(dispose).toBeDefined()

    control.emitReady()
    await flush()
    expect(applied.map((event) => event.seq)).toEqual([1])

    served.set(CHILD, [
      ...(served.get(CHILD) ?? []),
      eventOf({ threadId: CHILD, seq: 2, text: 'second' }),
    ])
    dispose?.()
    control.emitReady()
    await flush()
    expect(applied.map((event) => event.seq)).toEqual([1])
  })

  it('polls while refreshable and stands down while parked', async () => {
    const served = new Map<ThreadId, Event[]>([
      [CHILD, [eventOf({ threadId: CHILD, seq: 1, text: 'first' })]],
    ])
    const control = controllableChannelFor({ connection: OPEN })
    const app = {
      runner: Object.create(RemoteTurnRunner.prototype) as RemoteTurnRunner,
      channel: control.channel,
      log: stubLog(served),
      ledger: stubLedger,
    } as unknown as AtlasApp
    let applied: readonly Event[] = []
    const viewRefresh = refreshOf({
      app,
      threadId: CHILD,
      setEvents: (next) => (applied = next),
    })
    const dispose = driveThreadViewExternally({
      cloudChannel: control.channel as never,
      viewRefresh,
    })

    jest.advanceTimersByTime(4000)
    await Promise.resolve()
    await Promise.resolve()
    expect(applied.map((event) => event.seq)).toEqual([1])

    served.set(CHILD, [
      ...(served.get(CHILD) ?? []),
      eventOf({ threadId: CHILD, seq: 2, text: 'second' }),
    ])
    control.state.current = PARKED
    jest.advanceTimersByTime(8000)
    await Promise.resolve()
    expect(applied.map((event) => event.seq)).toEqual([1])

    control.state.current = OPEN
    jest.advanceTimersByTime(4000)
    await Promise.resolve()
    await Promise.resolve()
    expect(applied.map((event) => event.seq)).toEqual([1, 2])
    dispose?.()
  })

  it('does nothing for a thread the channel itself carries', () => {
    const control = controllableChannelFor({ connection: OPEN })
    const app = {
      runner: Object.create(RemoteTurnRunner.prototype) as RemoteTurnRunner,
      channel: control.channel,
      log: stubLog(new Map()),
      ledger: stubLedger,
    } as unknown as AtlasApp
    const viewRefresh = refreshOf({ app, threadId: ROOT })

    const dispose = driveThreadViewExternally({
      cloudChannel: control.channel as never,
      viewRefresh,
    })
    expect(dispose).toBeUndefined()
  })
})
