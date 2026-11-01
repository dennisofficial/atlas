import { expect, test } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'
import { createLocalActivityObserver, ELocalActivityState } from '../local-observer'
import type { LocalActivityInspector, OpenLocalActivityConnection } from '../local-inspection'

const threadId = toThreadId('local-root')
const completed: ReadActivityReply['observedOutcome'] = {
  identity: { kind: 'run', runId: 'real-run' },
  outcome: 'completed',
}

test('a stopped local root reads retained outcome without opening a channel', async () => {
  let opened = 0
  const observer = createLocalActivityObserver({
    known: async () => true,
    inspector: { inspect: async () => ({ state: 'not-running' }) },
    open: () => {
      opened += 1
      throw new Error('must not open')
    },
    outcomes: {
      read: async () => completed,
      observe: async () => {
        throw new Error('must not write')
      },
    },
  })
  expect(await observer.read({ threadId, lastAssistantSeq: 4, readSeq: null })).toEqual({
    activityState: ELocalActivityState.Available,
    status: {
      working: false,
      awaiting: null,
      lastOutcome: 'completed',
      podState: 'parked',
      lastAssistantSeq: 4,
      readSeq: null,
    },
  })
  expect(opened).toBe(0)
  observer.close()
})

const snapshot: ReadActivityReply = {
  runtimeId: 'runtime',
  revision: 1,
  turnEpoch: 1,
  working: false,
  awaiting: null,
  observedOutcome: completed,
}
const running: Awaited<ReturnType<LocalActivityInspector['inspect']>> = {
  state: 'running',
  endpoint: { url: 'http://127.0.0.1:1234' },
}

test('unknown roots and inspect failures never open or claim known idle', async () => {
  let known = false
  let inspections = 0
  let opens = 0
  const observer = createLocalActivityObserver({
    known: async () => known,
    inspector: {
      inspect: async () => {
        inspections += 1
        throw new Error('secret token')
      },
    },
    open: () => {
      opens += 1
      throw new Error('must not open')
    },
    outcomes: {
      read: async () => completed,
      observe: async () => ({ snapshot, outcome: completed }),
    },
  })
  expect(await observer.read({ threadId, lastAssistantSeq: 0, readSeq: null })).toEqual({
    activityState: ELocalActivityState.Unavailable,
    reason: 'Activity unavailable',
  })
  expect(inspections).toBe(0)
  known = true
  expect(
    (await observer.read({ threadId, lastAssistantSeq: 0, readSeq: null })).activityState,
  ).toBe(ELocalActivityState.Unavailable)
  expect(opens).toBe(0)
  observer.close()
})

test('late completion after disconnect never persists and reconnect needs a new inspection', async () => {
  let reply: (value: ReadActivityReply) => void = () => undefined
  let entered: () => void = () => undefined
  const readingStarted = new Promise<void>((resolve) => {
    entered = resolve
  })
  let disconnect: () => void = () => undefined
  let closed = 0
  let writes = 0
  let inspections = 0
  const observer = createLocalActivityObserver({
    known: async () => true,
    inspector: {
      inspect: async () => {
        inspections += 1
        return running
      },
    },
    open: (args) => {
      disconnect = args.disconnect
      return {
        read: () =>
          new Promise((resolve) => {
            reply = resolve
            entered()
          }),
        settled: async () => undefined,
        close: () => {
          closed += 1
        },
      }
    },
    outcomes: {
      read: async () => null,
      observe: async () => {
        writes += 1
        return { snapshot, outcome: completed }
      },
    },
  })
  await observer.prepare({ threadId })
  const reading = observer.read({ threadId, lastAssistantSeq: 2, readSeq: null })
  await readingStarted
  disconnect()
  reply(snapshot)
  expect((await reading).activityState).toBe(ELocalActivityState.Unavailable)
  expect(writes).toBe(0)
  expect(closed).toBe(1)
  expect(inspections).toBe(2)
  observer.close()
})

test('working suppresses retained outcome and stopped inspection closes live observation', async () => {
  let inspection: Awaited<ReturnType<LocalActivityInspector['inspect']>> = running
  let closes = 0
  const observer = createLocalActivityObserver({
    known: async () => true,
    inspector: { inspect: async () => inspection },
    open: () => ({
      read: async () => ({ ...snapshot, working: true }),
      settled: async () => undefined,
      close: () => {
        closes += 1
      },
    }),
    outcomes: {
      read: async () => completed,
      observe: async () => ({ snapshot: { ...snapshot, working: true }, outcome: completed }),
    },
  })
  const working = await observer.read({ threadId, lastAssistantSeq: 3, readSeq: 1 })
  expect(working).toMatchObject({ status: { working: true, lastOutcome: null } })
  inspection = { state: 'not-running' }
  expect(await observer.read({ threadId, lastAssistantSeq: 3, readSeq: 1 })).toMatchObject({
    status: { working: false, awaiting: null, lastOutcome: 'completed' },
  })
  expect(closes).toBe(1)
  observer.close()
})

test('continuous invalidations settle this row unavailable after three reads without waiting for quiescence', async () => {
  let invalidate: () => void = () => undefined
  let reads = 0
  let writes = 0
  const observer = createLocalActivityObserver({
    known: async () => true,
    inspector: { inspect: async () => running },
    open: (args) => {
      invalidate = args.invalidate
      return {
        read: async () => {
          reads += 1
          if (reads > 3) await new Promise<void>(() => undefined)
          invalidate()
          return snapshot
        },
        settled: async () => undefined,
        close: () => undefined,
      }
    },
    outcomes: {
      read: async () => null,
      observe: async () => {
        writes += 1
        return { snapshot, outcome: completed }
      },
    },
  })
  expect(
    (await observer.read({ threadId, lastAssistantSeq: 1, readSeq: null })).activityState,
  ).toBe(ELocalActivityState.Unavailable)
  expect(reads).toBe(3)
  expect(writes).toBe(0)
  observer.close()
})

test('invalidations reread complete activity and persist even without another summary poll', async () => {
  let invalidate: () => void = () => undefined
  let persisted: (value: unknown) => void = () => undefined
  let observed = new Promise((resolve) => {
    persisted = resolve
  })
  let candidate = snapshot
  const open: OpenLocalActivityConnection = (args) => {
    invalidate = args.invalidate
    return { read: async () => candidate, settled: async () => undefined, close: () => undefined }
  }
  const observer = createLocalActivityObserver({
    known: async () => true,
    inspector: { inspect: async () => running },
    open,
    outcomes: {
      read: async () => null,
      observe: async ({ candidate }) => {
        persisted(candidate)
        return { snapshot: candidate, outcome: candidate.observedOutcome }
      },
    },
  })
  await observer.read({ threadId, lastAssistantSeq: 0, readSeq: null })
  await observed
  observed = new Promise((resolve) => {
    persisted = resolve
  })
  candidate = { ...snapshot, revision: 2, turnEpoch: 2, working: true, observedOutcome: null }
  invalidate()
  expect(await observed).toEqual(candidate)
  observer.close()
})

test('awaited close cancels a hung passive inspection and settles the row unavailable', async () => {
  let seen: AbortSignal | undefined
  const entered = Promise.withResolvers<void>()
  const observer = createLocalActivityObserver({
    known: async () => true,
    inspector: {
      inspect: ({ signal }) => {
        seen = signal
        entered.resolve()
        return new Promise(() => undefined)
      },
    },
    open: () => {
      throw new Error('must not open')
    },
    outcomes: { read: async () => null, observe: async () => ({ snapshot, outcome: completed }) },
  })
  const reading = observer.read({ threadId, lastAssistantSeq: 1, readSeq: null })
  await entered.promise
  await observer.close()
  expect(seen?.aborted).toBe(true)
  expect((await reading).activityState).toBe(ELocalActivityState.Unavailable)
})
