import { describe, expect, it } from 'bun:test'

import {
  EShellStatus,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type EventLogPort,
} from '@dltech/atlas-core'

import { createDeltaChannel, withEventsAppendedPublishing, type DeltaChannel } from '..'
import { recorder } from './signals'

const threadId = toThreadId('thread-1')
const otherThreadId = toThreadId('thread-2')
const runId = toRunId('run-1')

function fakeLog(): EventLogPort & { readonly rows: Event[] } {
  const rows: Event[] = []

  return {
    rows,

    async append({ threadId: target, runId: run, drafts }) {
      const envelopes = drafts.map((_: EventDraft, index: number) => ({
        id: toEventId(`event-${rows.length + index + 1}`),
        seq: rows.length + index + 1,
        threadId: target,
        runId: run,
        depth: 0,
        at: '2026-08-24T00:00:00.000Z',
      }))
      const stamped = stampDrafts({ drafts, envelopes })
      rows.push(...stamped)
      return stamped
    },

    async read() {
      return [...rows]
    },

    async refresh() {},
    async head() {
      return rows.length
    },

    async readOwn({ threadId, upTo }) {
      return this.read({ threadId, ...(upTo === undefined ? {} : { upTo }) })
    },

    async replace() {
      return []
    },
  }
}

describe('a log that announces what it commits without settling a step', () => {
  it('publishes events-appended on the owning thread after the append succeeds', async () => {
    const channel = createDeltaChannel()
    const log = withEventsAppendedPublishing({ log: fakeLog(), channel: () => channel })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    const appended = await log.append({
      threadId,
      runId,
      drafts: [
        {
          type: 'background-shell-ended',
          shellId: 'bash_1',
          command: 'echo done',
          status: EShellStatus.Exited,
          exitCode: 0,
          output: 'done\n',
          droppedCharacters: 0,
          remainingCharacters: 0,
        },
      ],
    })

    expect(seen).toEqual([{ type: 'events-appended' }])
    expect(appended).toHaveLength(1)
  })

  it('publishes nothing while the channel is not resolvable yet', async () => {
    let channel: DeltaChannel | undefined
    const log = withEventsAppendedPublishing({ log: fakeLog(), channel: () => channel })

    await log.append({ threadId, runId, drafts: [{ type: 'user-said', text: 'hi' }] })
    await log.append({ threadId, runId, drafts: [{ type: 'user-said', text: 'there' }] })

    channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    await log.append({ threadId, runId, drafts: [{ type: 'user-said', text: 'late' }] })

    expect(seen).toEqual([{ type: 'events-appended' }])
  })

  it('publishes nothing for an append that fails', async () => {
    const channel = createDeltaChannel()
    const failing = fakeLog()
    failing.append = () => Promise.reject(new Error('disk full'))
    const log = withEventsAppendedPublishing({ log: failing, channel: () => channel })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    await expect(
      log.append({ threadId, runId, drafts: [{ type: 'user-said', text: 'lost' }] }),
    ).rejects.toThrow('disk full')

    expect(seen).toEqual([])
  })

  it('publishes nothing to a thread the append did not touch', async () => {
    const channel = createDeltaChannel()
    const log = withEventsAppendedPublishing({ log: fakeLog(), channel: () => channel })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    await log.append({
      threadId: otherThreadId,
      runId,
      drafts: [{ type: 'user-said', text: 'elsewhere' }],
    })

    expect(seen).toEqual([])
  })

  it('returns the committed events and reports when the channel resolution throws', async () => {
    const reported: unknown[] = []
    const log = withEventsAppendedPublishing({
      log: fakeLog(),
      channel: () => {
        throw new Error('channel not bound')
      },
      onListenerError: (cause) => {
        reported.push(cause)
      },
    })

    const appended = await log.append({
      threadId,
      runId,
      drafts: [{ type: 'user-said', text: 'kept' }],
    })

    expect(appended).toHaveLength(1)
    expect(reported).toHaveLength(1)
  })

  it('returns the committed events and reports when the publish call throws', async () => {
    const channel = createDeltaChannel()
    const reported: unknown[] = []
    const log = withEventsAppendedPublishing({
      log: fakeLog(),
      channel: () => ({
        ...channel,
        publisherFor: () => {
          throw new Error('publisher wedged')
        },
      }),
      onListenerError: (cause) => {
        reported.push(cause)
      },
    })

    const appended = await log.append({
      threadId,
      runId,
      drafts: [{ type: 'user-said', text: 'kept' }],
    })

    expect(appended).toHaveLength(1)
    expect(reported).toHaveLength(1)
  })

  it('forwards every other operation to the wrapped log untouched', async () => {
    const inner = fakeLog()
    const log = withEventsAppendedPublishing({ log: inner, channel: () => undefined })

    await log.append({ threadId, runId, drafts: [{ type: 'user-said', text: 'what changed?' }] })

    expect(await log.read({ threadId })).toEqual(inner.rows)
    expect(await log.head({ threadId })).toBe(1)
    expect(await log.readOwn({ threadId })).toEqual(inner.rows)
    await log.refresh({ threadId })
    expect(await log.replace({ threadId, runId, drafts: [] })).toEqual([])
  })
})
