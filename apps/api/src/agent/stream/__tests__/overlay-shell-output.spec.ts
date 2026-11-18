import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

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
      sessionId: SESSION,
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

  it('replays the backlog before a live frame that arrived while joining', async () => {
    live.shellBacklogs.set(SESSION, [
      JSON.stringify({ type: 'shell-output', shellId: 'shell-1', offset: 0, text: 'one\n' }),
    ])
    live.beforeRead = () => {
      live.publish({
        sessionId: SESSION,
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
