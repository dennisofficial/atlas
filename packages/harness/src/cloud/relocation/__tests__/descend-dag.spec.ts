import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import type { NoticePost } from '@dltech/atlas-core'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'
import { EClientRequest } from '../../channel-wire'
import { ETurnStatus } from '../../../loop/turn-outcome'

import { exportedSessionDirOf } from './fake-cloud-bridge'
import { cloudArchiveOf, descend, useDescendHome, type DescendHome, type OpenedLocal } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge, type FakeCloudChannel } from './fixture'
import { descendFromCloud, type DescendLocalHome, type DescendSurface, type WorkspaceRestorer } from '../descend'
import { fakeRestorer } from './workspace-fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const empties: string[] = []

afterEach(() => {
  for (const dir of empties.splice(0, empties.length)) rmSync(dir, { recursive: true, force: true })
})

const whitespaceSessionArchive = async (): Promise<SessionArchiveDescriptor | null> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-empty-seed-'))
  empties.push(home)
  const sessionDir = join(home, 'sessions', 'empty')
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'meta.json'), '{"unreadable":')
  return exportedSessionDirOf({ sessionDir })
}

const pausingChannel = (args: { channel: FakeCloudChannel; drop?: boolean }) => {
  let pauses = 0
  let resumes = 0
  let interrupts = 0
  args.channel.pause = () => {
    pauses += 1
    if (args.drop === true) return
    setTimeout(
      () =>
        args.channel.endTurn({ status: ETurnStatus.RelocationPaused, runId: toRunId('run_remote') }),
      0,
    )
  }
  args.channel.resume = () => {
    resumes += 1
  }
  const interrupted = args.channel.interrupt.bind(args.channel)
  args.channel.interrupt = () => {
    interrupts += 1
    interrupted()
  }
  return {
    get pauses() {
      return pauses
    },
    get resumes() {
      return resumes
    },
    get interrupts() {
      return interrupts
    },
  }
}

describe('the descend relocation plan', () => {
  it('pauses the remote turn at the seam rather than interrupting it', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const count = pausingChannel({ channel })

    const opened = await descend({ bridge, home, channel, midTurn: true })

    expect(count.pauses).toBe(1)
    expect(count.interrupts).toBe(0)
    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
  })

  it('leaves the source paused once the conversation is home, so nothing resumes in the sandbox', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const count = pausingChannel({ channel })

    await descend({ bridge, home, channel, midTurn: true })

    expect(count.resumes).toBe(0)
    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
  })

  it('pauses an idle cloud session too, waiting for the pause acknowledgement', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel

    const order: string[] = []
    const pause = channel.pause.bind(channel)
    channel.pause = () => {
      order.push('pause')
      pause()
    }
    const served = channel.request.bind(channel)
    channel.request = async (given) => {
      order.push(given.op)
      return served(given)
    }

    await descend({ bridge, home, channel, midTurn: false })

    expect(channel.paused).toBe(true)
    expect(order[0]).toBe('pause')
    expect(order.indexOf(EClientRequest.ReadSessionArchive)).toBeLessThan(
      order.indexOf(EClientRequest.PrepareWorkspaceArchive),
    )
  })

  it('gives up legibly when the pause never lands, leaving everything in the cloud', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const count = pausingChannel({ channel, drop: true })

    await expect(
      descend({ bridge, home, channel, midTurn: true, pauseDeadlineMs: 20 }),
    ).rejects.toThrow('would not pause in time')

    expect(count.resumes).toBe(1)
    expect(channel.requests).toEqual([])
    expect(await home.threads.find({ threadId: CLOUD_THREAD })).toBeUndefined()
    expect(bridge.destroyed).toEqual([])
  })

  it('resumes the paused loops when the descent fails after the pause landed', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: null })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const count = pausingChannel({ channel })

    await expect(descend({ bridge, home, channel, midTurn: true })).rejects.toThrow(
      'the cloud holds no transcript',
    )

    expect(count.resumes).toBe(1)
    expect(bridge.destroyed).toEqual([])
  })

  it('opens the conversation locally before the ownership flip', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const order: string[] = []
    const flipped = home.threads.chooseExecutionLocation.bind(home.threads)
    home.threads.chooseExecutionLocation = async (given) => {
      if (given.threadId === CLOUD_THREAD) order.push('flip')
      return flipped(given)
    }

    await descendWithSurface({
      home,
      bridge,
      openLocal: async (_openedHome, threadId) => {
        order.push('open')
        return { threadId }
      },
    })

    expect(order).toEqual(['open', 'flip'])
  })

  it('flips nothing and keeps the source when the local open fails', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const count = pausingChannel({ channel })

    await expect(
      descendWithSurface({
        home,
        bridge,
        channel,
        openLocal: async () => {
          throw new Error('the session dir was unreadable')
        },
      }),
    ).rejects.toThrow('the session dir was unreadable')

    const row = await home.threads.find({ threadId: CLOUD_THREAD })
    expect(row?.executionLocation ?? EExecutionLocation.Cloud).toBe(EExecutionLocation.Cloud)
    expect(count.resumes).toBe(1)
    expect(bridge.destroyed).toEqual([])
  })

  it('refuses the flip when the shipped archive lands an unusable session directory', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await whitespaceSessionArchive() })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel

    await expect(descend({ bridge, home, channel })).rejects.toThrow(/no root metadata/)

    const row = await home.threads.find({ threadId: CLOUD_THREAD })
    expect(row?.executionLocation ?? EExecutionLocation.Cloud).toBe(EExecutionLocation.Cloud)
    expect(bridge.destroyed).toEqual([])
  })
})

const descendWithSurface = (args: {
  home: DescendHome
  bridge: ReturnType<typeof fakeBridge>
  channel?: FakeCloudChannel
  openLocal: (home: DescendLocalHome, threadId: ThreadId) => Promise<OpenedLocal>
  restoreWorkspace?: WorkspaceRestorer
}): Promise<OpenedLocal> => {
  const surface: DescendSurface<OpenedLocal> = {
    notice: { notify: (_post: NoticePost) => undefined },
    openLocal: (home, threadId) => args.openLocal(home, threadId),
  }
  return descendFromCloud({
    threadId: CLOUD_THREAD,
    target: EExecutionLocation.Host,
    midTurn: false,
    bridge: args.bridge,
    channel: args.channel ?? args.bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel,
    localApp: args.home,
    surface,
    restoreWorkspace: args.restoreWorkspace ?? fakeRestorer().restore,
  })
}
