import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId, type Event, type ThreadId } from '@dltech/atlas-core'

import { EConnectionView } from '../../cloud/connection-view'
import type { ChannelReload } from '../../cloud/remote-delta-channel'
import { eventLogFile, sessionDirectory } from '../../store/sessions/paths'
import { SessionRegistry } from '../../store/sessions/registry'
import type { ThreadModel } from '../../store/thread-store'
import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { startPodLocalCopy, type LocalCopyChannel } from '../local-copy'

const THREAD = toThreadId('brn_copied_pod')
const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const eventAt = (seq: number, text = `said ${seq}`): Event => ({
  type: 'user-said',
  text,
  id: toEventId(`pod-evt-${seq}-${text}`),
  seq,
  threadId: THREAD,
  runId: toRunId('pod-run'),
  depth: 0,
  at: '2026-10-30T00:00:00.000Z',
})

const range = (from: number, to: number): Event[] =>
  Array.from({ length: to - from + 1 }, (_, index) => eventAt(from + index))

type Rig = ReturnType<typeof rigOf>

const rigOf = (args: { connected?: boolean } = {}) => {
  const fixture = openStoreFixture()
  fixtures.push(fixture)
  let remote: Event[] = []
  let remoteTitle: string | undefined
  let remoteModel: ThreadModel | undefined
  const readies = new Set<() => void>()
  const reloads = new Set<(reload: ChannelReload) => void>()
  const signals = new Set<(signal: { type: string }) => void>()
  const models = new Set<(chosen: { threadId: ThreadId; model: ThreadModel }) => void>()
  let failReads = false
  let view: EConnectionView = EConnectionView.Parked
  const channel: LocalCopyChannel = {
    threadId: THREAD,
    connection: () => ({ state: view, detail: null }),
    onReady: (listener) => {
      readies.add(listener)
      return () => readies.delete(listener)
    },
    onReload: (listener) => {
      reloads.add(listener)
      return () => reloads.delete(listener)
    },
    subscribe: ({ listener }) => {
      signals.add(listener)
      return () => signals.delete(listener)
    },
  }
  if (args.connected === true) view = EConnectionView.Connected
  const copy = startPodLocalCopy({
    home: fixture.home,
    registry: () => new SessionRegistry(fixture.home),
    threadId: THREAD,
    channel,
    remote: {
      log: {
        readOwn: async ({ fromSeq }) => {
          if (failReads) throw new Error('the pod went away')
          return remote.filter((event) => event.seq > (fromSeq ?? 0))
        },
      },
      threads: {
        find: async () => ({ title: remoteTitle, model: remoteModel }),
        onModelChosen: (listener) => {
          models.add(listener)
          return () => models.delete(listener)
        },
      },
    },
    homeThreads: fixture.threads,
  })
  return {
    fixture,
    copy,
    setRemote: (events: Event[]) => {
      remote = events
    },
    setTitle: (title: string) => {
      remoteTitle = title
    },
    setModel: (model: ThreadModel) => {
      remoteModel = model
    },
    failReads: () => {
      failReads = true
    },
    ready: () => {
      for (const listener of [...readies]) listener()
    },
    reload: (reload: ChannelReload) => {
      for (const listener of [...reloads]) listener(reload)
    },
    appended: () => {
      for (const listener of [...signals]) listener({ type: 'events-appended' })
    },
    chooseModel: (model: ThreadModel) => {
      for (const listener of [...models]) listener({ threadId: THREAD, model })
    },
  }
}

const textsOnDisk = (rig: Rig): string[] => {
  const file = eventLogFile({
    sessionDir: sessionDirectory({ home: rig.fixture.home, sessionId: THREAD }),
    threadId: THREAD,
  })
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { body: { text: string } }).body.text)
}

describe('the local copy of a pod thread', () => {
  it('backfills everything the pod holds once the channel is ready', async () => {
    const rig = rigOf()
    rig.setRemote(range(1, 3))

    rig.ready()
    await rig.copy.settled()

    expect(textsOnDisk(rig)).toEqual(['said 1', 'said 2', 'said 3'])
    rig.copy.stop()
  })

  it('appends what arrives after the backfill', async () => {
    const rig = rigOf()
    rig.setRemote(range(1, 2))
    rig.ready()
    await rig.copy.settled()

    rig.setRemote(range(1, 4))
    rig.appended()
    await rig.copy.settled()

    expect(textsOnDisk(rig)).toEqual(['said 1', 'said 2', 'said 3', 'said 4'])
    rig.copy.stop()
  })

  it('rewrites from the first divergence when the pod rewrote its history', async () => {
    const rig = rigOf()
    rig.setRemote(range(1, 4))
    rig.ready()
    await rig.copy.settled()

    rig.setRemote([eventAt(1), eventAt(2), eventAt(3, 'rewound')])
    rig.reload({ sinceEventSeq: 0 })
    await rig.copy.settled()

    expect(textsOnDisk(rig)).toEqual(['said 1', 'said 2', 'rewound'])
    rig.copy.stop()
  })

  it('rewrites a copy whose tail the pod rewound while this client was away', async () => {
    const rig = rigOf()
    rig.setRemote(range(1, 4))
    rig.ready()
    await rig.copy.settled()

    rig.setRemote([...range(1, 2), eventAt(3, 'rewound'), eventAt(4, 'new'), eventAt(5, 'newer')])
    rig.ready()
    await rig.copy.settled()

    expect(textsOnDisk(rig)).toEqual(['said 1', 'said 2', 'rewound', 'new', 'newer'])
    rig.copy.stop()
  })

  it('backfills at once when it starts against a channel that is already connected', async () => {
    const rig = rigOf({ connected: true })
    rig.setRemote(range(1, 2))

    await Promise.resolve()
    await rig.copy.settled()

    expect(textsOnDisk(rig)).toEqual(['said 1', 'said 2'])
    rig.copy.stop()
  })

  it('carries the pod title and model into the home thread store', async () => {
    const rig = rigOf()
    const thread = await rig.fixture.threads.create({ workspace: '/w', repo: null, id: THREAD })
    rig.setRemote(range(1, 1))
    rig.setTitle('Pod thread')
    rig.setModel({ ref: 'anthropic/claude-opus', effort: 'high' })

    rig.ready()
    await rig.copy.settled()
    rig.chooseModel({ ref: 'openai/gpt-5', effort: 'low' })
    await rig.copy.settled()

    const held = await rig.fixture.threads.find({ threadId: thread.id })
    expect(held?.title).toBe('Pod thread')
    expect(held?.model).toEqual({ ref: 'openai/gpt-5', effort: 'low' })
    rig.copy.stop()
  })

  it('shrugs off a read the pod cannot answer', async () => {
    const rig = rigOf()
    rig.failReads()

    rig.ready()
    await rig.copy.settled()

    rig.copy.stop()
  })

  it('writes nothing once stopped', async () => {
    const rig = rigOf()
    rig.setRemote(range(1, 2))
    rig.ready()
    await rig.copy.settled()
    rig.copy.stop()

    rig.setRemote(range(1, 5))
    rig.appended()
    await rig.copy.settled()

    expect(textsOnDisk(rig)).toEqual(['said 1', 'said 2'])
  })
})
