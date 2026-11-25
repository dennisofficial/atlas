import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  ESessionStatus,
  ETurnCause,
  toRunId,
  toThreadId,
  type Lease,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { ControlPlane } from '../src'
import { LeaseOps } from '../src/lease-ops'
import type { ControlTx, SessionDigestRow } from '../src/port'
import { withDigestViews } from '../src/session-digest-view'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-06T12:00:00.000Z'
const USER = 'user-a'
const PRESENT = 'session-present'
const ABSENT = 'session-absent'
const TURN_STARTED: RecordEventBody = {
  type: 'turn-started',
  turnId: 'turn-1',
  cause: ETurnCause.Input,
}

class ForgetfulLeaseOps extends LeaseOps {
  override async currentLeasesIn(params: {
    tx: ControlTx
    sessionIds: readonly string[]
  }): Promise<Map<string, { lease: Lease; live: boolean }>> {
    const all = await super.currentLeasesIn(params)
    return new Map([...all].filter(([sessionId]) => sessionId !== ABSENT))
  }
}

const appendOne = async (args: {
  plane: ControlPlane
  threadId: string
  epoch: number
  body: RecordEventBody
}): Promise<void> => {
  const outcome = await args.plane.append({
    threadId: args.threadId,
    epoch: args.epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('run-1'),
      epoch: args.epoch,
      at: NOW,
      bodies: [args.body],
      from: await args.plane.head({ threadId: args.threadId }),
    }),
  })
  if (!outcome.ok) throw new Error('append refused')
}

const setup = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store, clock: () => NOW })
  const epochs = new Map<string, number>()
  for (const [index, sessionId] of [PRESENT, ABSENT].entries()) {
    const threadId = `${sessionId}-thread`
    await plane.createSession({
      sessionId,
      userId: USER,
      projectId: 'project-a',
      mainThreadId: threadId,
    })
    const lease = await plane.grant({ sessionId, hostId: 7 + index })
    store.markHostPresent(7 + index)
    epochs.set(sessionId, lease.epoch)
    await appendOne({ plane, threadId, epoch: lease.epoch, body: TURN_STARTED })
  }
  const epochOf = (sessionId: string): number => {
    const epoch = epochs.get(sessionId)
    if (epoch === undefined) throw new Error(`no epoch for ${sessionId}`)
    return epoch
  }
  const digestsWith = async (args: {
    leases: LeaseOps
    rows: (rows: SessionDigestRow[]) => SessionDigestRow[]
  }) =>
    store.transact(async (tx) =>
      withDigestViews({
        tx,
        leases: args.leases,
        rows: args.rows(await tx.listSessionDigests({ userId: USER, limit: 10 })),
        now: NOW,
        withView: true,
      }),
    )
  return { store, epochOf, digestsWith }
}

describe('degraded session digests', () => {
  it('returns the other rows when one session has no main thread row', async () => {
    const { store, digestsWith } = await setup()
    const digests = await digestsWith({
      leases: new LeaseOps({ store }),
      rows: (rows) =>
        rows.map((row) =>
          row.sessionId === ABSENT ? { ...row, mainThreadId: 'thread-that-is-gone' } : row,
        ),
    })
    expect(digests.map((digest) => digest.sessionId).sort()).toEqual([ABSENT, PRESENT])
    expect(digests.find((digest) => digest.sessionId === ABSENT)?.view).toBeNull()
    expect(digests.find((digest) => digest.sessionId === PRESENT)?.view?.status.state).toBe(
      ESessionStatus.Thinking,
    )
  })

  it('reads a session with no lease row as not live instead of failing the read', async () => {
    const { store, digestsWith } = await setup()
    const digests = await digestsWith({
      leases: new ForgetfulLeaseOps({ store }),
      rows: (rows) => rows,
    })
    const present = digests.find((digest) => digest.sessionId === PRESENT)
    const absent = digests.find((digest) => digest.sessionId === ABSENT)
    expect(present?.view?.status.state).toBe(ESessionStatus.Thinking)
    expect(absent?.view).not.toBeNull()
    expect(absent?.view?.status.state).toBe(ESessionStatus.Resuming)
  })
})
