import { afterEach, describe, expect, test } from 'bun:test'
import { type CloudConnection, EConnectionView } from '@dltech/atlas-harness'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { dismissNotice, ENoticeTone, notify } from '../../../src/ui/notice-store'
import { bannerIn, waitFor, type WatchableChannel, warnNotices, watchChannel } from '../rig-observer'

const checkpointAt = (args: { phase: ERuntimePhase.Serving | ERuntimePhase.Parked; revision: number }) =>
  ({
    threadId: 'thr_rig',
    runtimeId: 'rt_rig',
    sandboxSessionId: 'sbx_rig',
    revision: args.revision,
    reportedAt: '2026-10-17T12:00:00.000Z',
    transcript: { head: 0, count: 0, digest: '0'.repeat(64) },
    phase: args.phase,
  }) satisfies RuntimeCheckpoint

type FakeChannel = WatchableChannel & {
  emitConnection: (state: EConnectionView) => void
  emitCheckpoint: (checkpoint: RuntimeCheckpoint) => void
  listenerCount: () => number
}

const fakeChannel = (args: { state: EConnectionView; checkpoint: RuntimeCheckpoint | null }): FakeChannel => {
  const connectionListeners = new Set<(connection: CloudConnection) => void>()
  const checkpointListeners = new Set<(checkpoint: RuntimeCheckpoint) => void>()
  let connection: CloudConnection = { state: args.state, detail: null }
  return {
    connection: () => connection,
    onConnection: (listener) => {
      connectionListeners.add(listener)
      return () => connectionListeners.delete(listener)
    },
    checkpoint: () => args.checkpoint,
    onCheckpoint: (listener) => {
      checkpointListeners.add(listener)
      return () => checkpointListeners.delete(listener)
    },
    emitConnection: (state) => {
      connection = { state, detail: null }
      for (const listener of connectionListeners) listener(connection)
    },
    emitCheckpoint: (checkpoint) => {
      for (const listener of checkpointListeners) listener(checkpoint)
    },
    listenerCount: () => connectionListeners.size + checkpointListeners.size,
  }
}

describe('watchChannel', () => {
  test('seeds the view and checkpoint, then records only view changes', () => {
    const channel = fakeChannel({
      state: EConnectionView.Parked,
      checkpoint: checkpointAt({ phase: ERuntimePhase.Parked, revision: 3 }),
    })
    const lines: string[] = []
    const watch = watchChannel({ channel, log: (line) => lines.push(line) })

    channel.emitConnection(EConnectionView.Waking)
    channel.emitConnection(EConnectionView.Waking)
    channel.emitConnection(EConnectionView.Connected)
    channel.emitCheckpoint(checkpointAt({ phase: ERuntimePhase.Serving, revision: 4 }))

    expect(watch.views()).toEqual(['parked', 'waking', 'connected'])
    expect(watch.checkpoints().map((checkpoint) => checkpoint.revision)).toEqual([3, 4])
    expect(watch.lastPhase()).toBe('serving')
    expect(lines).toContain('view waking')
    expect(lines).toContain('record serving (revision 4)')
  })

  test('works with a channel that has no checkpoint surface', () => {
    const lines: string[] = []
    let emit: (connection: CloudConnection) => void = () => undefined
    const bare: WatchableChannel = {
      connection: () => ({ state: EConnectionView.Connected, detail: null }),
      onConnection: (listener) => {
        emit = listener
        return () => undefined
      },
    }
    const watch = watchChannel({ channel: bare, log: (line) => lines.push(line) })
    emit({ state: EConnectionView.Reconnecting, detail: null })

    expect(watch.views()).toEqual(['connected', 'reconnecting'])
    expect(watch.checkpoints()).toEqual([])
    expect(watch.lastPhase()).toBeNull()
  })

  test('stop unsubscribes every listener', () => {
    const channel = fakeChannel({ state: EConnectionView.Connected, checkpoint: null })
    const watch = watchChannel({ channel, log: () => undefined })
    expect(channel.listenerCount()).toBe(2)

    watch.stop()
    channel.emitConnection(EConnectionView.Disconnected)

    expect(channel.listenerCount()).toBe(0)
    expect(watch.views()).toEqual(['connected'])
  })
})

describe('warnNotices', () => {
  afterEach(() => {
    dismissNotice()
  })

  test('keeps only warning notices', () => {
    notify({ text: 'all good', tone: ENoticeTone.Info })
    notify({ text: 'cloud sandbox lost', tone: ENoticeTone.Warn })
    notify({ text: 'done', tone: ENoticeTone.Done })

    expect(warnNotices()).toEqual([{ tone: ENoticeTone.Warn, text: 'cloud sandbox lost' }])
  })
})

describe('bannerIn', () => {
  test('returns the first banner line', () => {
    const frame = ['  composer', '  ☁ sandbox disconnected — retrying  ', '  ✗ failed'].join('\n')
    expect(bannerIn(frame)).toBe('☁ sandbox disconnected — retrying')
  })

  test('matches parking and refusal banners case-insensitively', () => {
    expect(bannerIn('header\nParking the cloud sandbox')).toBe('Parking the cloud sandbox')
    expect(bannerIn('the serve accepts no new work')).toBe('the serve accepts no new work')
  })

  test('returns null for a clean frame', () => {
    expect(bannerIn('☁ cloud ▾\nconnected\n> ')).toBeNull()
  })
})

describe('waitFor', () => {
  test('resolves true once the condition holds', async () => {
    let polls = 0
    const held = await waitFor({
      what: 'third poll',
      holds: () => {
        polls += 1
        return polls >= 3
      },
      within: 1_000,
      every: 5,
    })
    expect(held).toBe(true)
    expect(polls).toBe(3)
  })

  test('accepts an async condition', async () => {
    expect(await waitFor({ what: 'async', holds: async () => true, within: 100, every: 5 })).toBe(true)
  })

  test('resolves false after the deadline', async () => {
    const started = Date.now()
    expect(await waitFor({ what: 'never', holds: () => false, within: 40, every: 10 })).toBe(false)
    expect(Date.now() - started).toBeGreaterThanOrEqual(35)
  })
})
