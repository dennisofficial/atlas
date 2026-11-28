import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EStreamBlockKind } from '@dltech/atlas-protocol'
import { FOLLOW_HIGH_WATER_BYTES } from '../follow-limits'
import { FakeLiveSource } from './fake-live-source'
import { FollowRig, SESSION } from './follow-rig'

describe('live shell output', () => {
  let live: FakeLiveSource
  let rig: FollowRig

  beforeEach(async () => {
    live = new FakeLiveSource()
    rig = new FollowRig({ live })
    rig.store.markHostPresent(1)
    await rig.seed({ events: 1 })
  })

  afterEach(() => {
    rig.dispose()
  })

  it('sends the shell backlog to a subscriber that joins mid-shell, then live frames', async () => {
    live.shellBacklogs.set(SESSION, [
      JSON.stringify({ type: 'shell-output', shellId: 'shell-1', offset: 0, text: 'one\n' }),
      'not a frame',
    ])
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    live.publish({
      key: SESSION,
      frame: { type: 'shell-output', shellId: 'shell-1', offset: 4, text: 'two\n' },
    })
    await rig.settled()

    expect(rig.sent.filter((message) => message.type === 'frame')).toEqual([
      {
        type: 'frame',
        id: 'sub-1',
        frame: { type: 'shell-output', shellId: 'shell-1', offset: 0, text: 'one\n' },
      },
      {
        type: 'frame',
        id: 'sub-1',
        frame: { type: 'shell-output', shellId: 'shell-1', offset: 4, text: 'two\n' },
      },
    ])
  })

  it('keeps delivery cursors across model changes, resnaps and source gaps, independently per watcher', async () => {
    const shell = { type: 'shell-output' as const, shellId: 'shell-1', offset: 0, text: 'one\n' }
    live.shellBacklogs.set(SESSION, [JSON.stringify(shell)])
    const first = rig.open()
    await rig.subscribe({ session: first })
    await rig.settled()
    const key = { runId: 'run-1', step: 0, attempt: 0 }
    live.publish({ key: SESSION, frame: { type: 'step-start', key, afterSeq: 1 } })
    live.publish({
      key: SESSION,
      frame: {
        type: 'delta',
        key,
        block: 'text',
        kind: EStreamBlockKind.Text,
        from: 0,
        text: 'model',
      },
    })
    await rig.settled()
    await first.handle({ type: 'resnap', id: 'sub-1' })
    live.gap()
    await rig.settled()
    await rig.subscribe({ session: rig.open(), id: 'sub-2' })
    await rig.settled()
    live.publish({ key: SESSION, frame: shell })
    await rig.settled()
    expect(rig.frames('frame').map((message) => [message.id, message.frame])).toEqual([
      ['sub-1', shell],
      ['sub-2', shell],
    ])
  })

  it('resumes rejected live shell frames on drain without reading another snapshot', async () => {
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.settled()
    const reads = live.reads
    rig.buffered = FOLLOW_HIGH_WATER_BYTES
    const shell = { type: 'shell-output' as const, shellId: 'shell-1', offset: 0, text: '😀' }
    live.publish({ key: SESSION, frame: shell })
    live.publish({ key: SESSION, frame: shell })
    live.publish({ key: SESSION, frame: { ...shell, offset: 2, text: 'done' } })
    await rig.settled()
    expect(rig.frames('frame')).toEqual([])
    rig.buffered = 0
    session.drain()
    await rig.settled()
    expect(rig.frames('frame').map((message) => message.frame)).toEqual([
      shell,
      { ...shell, offset: 2, text: 'done' },
    ])
    expect(live.reads).toBe(reads)
  })

  it('replays the backlog before a live frame that arrived while joining', async () => {
    live.shellBacklogs.set(SESSION, [
      JSON.stringify({ type: 'shell-output', shellId: 'shell-1', offset: 0, text: 'one\n' }),
    ])
    live.beforeRead = () => {
      live.publish({
        key: SESSION,
        frame: { type: 'shell-output', shellId: 'shell-1', offset: 4, text: 'two\n' },
      })
    }

    await rig.subscribe({ session: rig.open() })
    await rig.settled()

    expect(rig.sent.filter((message) => message.type === 'frame')).toEqual([
      {
        type: 'frame',
        id: 'sub-1',
        frame: { type: 'shell-output', shellId: 'shell-1', offset: 0, text: 'one\n' },
      },
      {
        type: 'frame',
        id: 'sub-1',
        frame: { type: 'shell-output', shellId: 'shell-1', offset: 4, text: 'two\n' },
      },
    ])
  })
})
