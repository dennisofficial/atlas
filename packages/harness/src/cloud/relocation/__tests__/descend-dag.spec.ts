import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import type { NoticePost } from '@dltech/atlas-core'
import { EClientRequest } from '../../channel-wire'
import { ETurnStatus } from '../../../loop/turn-outcome'

import { buildSessionArchive } from '../../session-archive'
import { cloudArchiveOf, descend, useDescendHome, type DescendHome, type OpenedLocal } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge, type FakeCloudChannel } from './fixture'
import { descendFromCloud, type DescendLocalHome, type DescendSurface, type WorkspaceMerger } from '../descend'

const said = (text: string) => ({ type: 'user-said' as const, text })

const empties: string[] = []

afterEach(() => {
  for (const dir of empties.splice(0, empties.length)) rmSync(dir, { recursive: true, force: true })
})

const whitespaceSessionArchive = async (): Promise<string> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-empty-seed-'))
  empties.push(home)
  const sessionDir = join(home, 'sessions', 'empty')
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'meta.json'), '{"unreadable":')
  const built = await buildSessionArchive({ sessionDir })
  return built?.toString('base64') ?? ''
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

  it('resumes the paused remote loops once the conversation is home again', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const count = pausingChannel({ channel })

    await descend({ bridge, home, channel, midTurn: true })

    expect(count.resumes).toBe(1)
  })

  it('gives up legibly when the pause never lands, leaving everything in the cloud', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const count = pausingChannel({ channel, drop: true })

    await expect(
      descend({ bridge, home, channel, midTurn: true, pauseDeadlineMs: 20 }),
    ).rejects.toThrow('would not pause in time')

    expect(count.resumes).toBe(0)
    expect(await home.threads.find({ threadId: CLOUD_THREAD })).toBeUndefined()
    expect(bridge.destroyed).toEqual([])
  })

  it('resumes the paused loops when the descent fails after the pause landed', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: '' })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const count = pausingChannel({ channel })

    await expect(descend({ bridge, home, channel, midTurn: true })).rejects.toThrow(
      'the cloud holds no transcript',
    )

    expect(count.resumes).toBe(1)
    expect(bridge.destroyed).toEqual([])
  })

  it('merges the published workspace only after the thread store has flipped home', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = publishingChannel({ bridge })
    const order: string[] = []
    const threads = home.threads
    const flipped = threads.chooseExecutionLocation.bind(threads)
    threads.chooseExecutionLocation = async (given) => {
      if (given.threadId === CLOUD_THREAD) order.push('flip')
      return flipped(given)
    }

    await descend({
      bridge,
      home,
      channel,
      mergeWorkspace: async () => {
        order.push('merge')
        return { conflicts: [] }
      },
    })

    expect(order.indexOf('flip')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('merge')).toBe(order.indexOf('flip') + 1)
  })

  it('opens the conversation locally only after the workspace merge settled', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const order: string[] = []

    await descendWithSurface({
      home,
      bridge,
      channel: publishingChannel({ bridge }),
      openLocal: async (_openedHome, threadId) => {
        order.push('open')
        return { threadId }
      },
      mergeWorkspace: async () => {
        order.push('merge')
        return { conflicts: [] }
      },
    })

    expect(order).toEqual(['merge', 'open'])
  })

  it('fails the move without a local reopen when the workspace will not merge', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    let opens = 0

    await expect(
      descendWithSurface({
        home,
        bridge,
        channel: publishingChannel({ bridge }),
        openLocal: async (_openedHome, threadId) => {
          opens += 1
          return { threadId }
        },
        mergeWorkspace: async () => {
          throw new Error('the merge blew up')
        },
      }),
    ).rejects.toThrow('the merge blew up')

    expect(opens).toBe(0)
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
    expect(readdirSync(join(sessionDirOf(), 'threads'))).not.toEqual([])
  })

  it('reopens as the failure recovery when the local open itself fails', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })

    await expect(
      descendWithSurface({
        home,
        bridge,
        openLocal: async () => {
          throw new Error('the session dir was unreadable')
        },
      }),
    ).rejects.toThrow('the session dir was unreadable')

    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
  })

  it('refuses the flip when the shipped archive lands an unusable session directory', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await whitespaceSessionArchive() })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel

    await expect(descend({ bridge, home, channel })).rejects.toThrow(/landed unusable/)

    const row = await home.threads.find({ threadId: CLOUD_THREAD })
    expect(row?.executionLocation ?? EExecutionLocation.Cloud).toBe(EExecutionLocation.Cloud)
    expect(bridge.destroyed).toEqual([])
  })
})

const PUBLISHED = {
  ref: 'refs/atlas/descend/cloud-thread-0123456789ab',
  commit: '0123456789abcdef',
  base: 'ba51e1e0',
  baseTree: '7ee1ab1e',
  branch: 'dennis/feature',
}

const publishingChannel = (args: { bridge: ReturnType<typeof fakeBridge> }): FakeCloudChannel => {
  const channel = args.bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
  const served = channel.request.bind(channel)
  channel.request = async (given) => {
    if (given.op === EClientRequest.PublishWorkspace) return PUBLISHED
    return served(given)
  }
  return channel
}

const sessionDirOf = (): string =>
  join(process.env['ATLAS_HOME'] ?? '', 'sessions', CLOUD_THREAD)

const descendWithSurface = (args: {
  home: DescendHome
  bridge: ReturnType<typeof fakeBridge>
  channel?: FakeCloudChannel
  openLocal: (home: DescendLocalHome, threadId: ThreadId) => Promise<OpenedLocal>
  mergeWorkspace?: WorkspaceMerger
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
    ...(args.mergeWorkspace === undefined ? {} : { mergeWorkspace: args.mergeWorkspace }),
  })
}
