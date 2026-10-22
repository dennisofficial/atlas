import { describe, expect, it } from 'bun:test'
import { toRunId, toThreadId } from '@dltech/atlas-core'

import { EClientRequest } from '../channel-wire'
import type { RemoteDeltaChannel } from '../remote-delta-channel'
import { RemoteEventLog } from '../remote-event-log'

type Call = { op: EClientRequest; params: unknown }

const THREAD = toThreadId('brn_test')
const RUN = toRunId('run_test')

const wireEvent = {
  id: 'evt_1',
  threadId: 'brn_test',
  seq: 1,
  runId: 'run_test',
  depth: 0,
  at: '2026-09-15T00:00:00.000Z',
  type: 'user-said',
  body: JSON.stringify({ type: 'user-said', text: 'hello' }),
}

const harness = (events: unknown[] = [wireEvent]) => {
  const calls: Call[] = []
  const channel: Pick<RemoteDeltaChannel, 'request'> = {
    request: async (args: { op: EClientRequest; params: unknown }) => {
      calls.push({ op: args.op, params: args.params })
      return { events }
    },
  }
  return { log: new RemoteEventLog({ channel }), calls }
}

describe('RemoteEventLog', () => {
  it('read answers over the channel and decodes the events', async () => {
    const { log, calls } = harness()

    const events = await log.read({ threadId: THREAD })

    expect(calls[0]?.op).toBe(EClientRequest.ReadEvents)
    expect(calls[0]?.params).toEqual({ threadId: THREAD })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ seq: 1, id: 'evt_1', type: 'user-said' })
  })

  it('read passes fromSeq and upTo through, and readOwn sets the own flag', async () => {
    const { log, calls } = harness()

    await log.read({ threadId: THREAD, fromSeq: 3, upTo: 7 })
    await log.readOwn({ threadId: THREAD })

    expect(calls[0]?.params).toEqual({ threadId: THREAD, fromSeq: 3, upTo: 7 })
    expect(calls[1]?.params).toEqual({ threadId: THREAD, own: true })
  })

  it('head is the last event sequence, and zero when the log is empty', async () => {
    const { log } = harness()
    const { log: empty } = harness([])

    expect(await log.head({ threadId: THREAD })).toBe(1)
    expect(await empty.head({ threadId: THREAD })).toBe(0)
  })

  it('append refuses — the sandbox owns the writes', async () => {
    const { log, calls } = harness()

    await expect(
      log.append({ threadId: THREAD, runId: RUN, drafts: [{ type: 'user-said', text: 'x' }] }),
    ).rejects.toThrow('the sandbox owns the transcript')
    expect(calls).toHaveLength(0)
  })

  it('replace refuses — the sandbox owns the writes', async () => {
    const { log, calls } = harness()

    await expect(
      log.replace({ threadId: THREAD, runId: RUN, drafts: [] }),
    ).rejects.toThrow('the sandbox owns the transcript')
    expect(calls).toHaveLength(0)
  })
})
