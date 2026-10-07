import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { EChannelConnection } from '../../remote-delta-channel'
import { ETurnStatus } from '../../../loop/turn-outcome'

import { cloudArchiveOf, descend, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge, type FakeCloudChannel } from './fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const parkedChannel = (channel: FakeCloudChannel): void => {
  channel.moveTo({ state: EChannelConnection.Parked, detail: null })
}

describe('a descend whose sandbox is parked', () => {
  it('wakes before it pauses, and the pause lands once the channel attaches', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    parkedChannel(channel)

    const order: string[] = []
    const pause = channel.pause.bind(channel)
    channel.pause = () => {
      order.push('pause')
      pause()
    }

    let wakes = 0
    const opened = await descend({
      bridge,
      home,
      channel,
      wake: async () => {
        wakes += 1
        order.push('wake')
        channel.moveTo({ state: EChannelConnection.Open, detail: null })
      },
    })

    expect(wakes).toBe(1)
    expect(order).toEqual(['wake', 'pause'])
    expect(channel.paused).toBe(true)
    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
  })

  it('never wakes a channel that is already attached', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel

    let wakes = 0
    await descend({ bridge, home, channel, wake: async () => { wakes += 1 } })

    expect(wakes).toBe(0)
  })

  it('wakes a stranded-closed channel the same as a parked one', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    channel.moveTo({ state: EChannelConnection.Closed, detail: 'the sandbox was not woken by transport recovery' })

    let wakes = 0
    await descend({
      bridge,
      home,
      channel,
      wake: async () => {
        wakes += 1
        channel.moveTo({ state: EChannelConnection.Open, detail: null })
      },
    })

    expect(wakes).toBe(1)
    expect(channel.paused).toBe(true)
  })

  it('aborts before anything moves when the wake fails', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    parkedChannel(channel)

    await expect(
      descend({
        bridge,
        home,
        channel,
        wake: async () => {
          throw new Error('the sandbox could not be provisioned')
        },
      }),
    ).rejects.toThrow('the sandbox could not be provisioned')

    expect(channel.paused).toBe(false)
    expect(channel.requests).toEqual([])
    expect(await home.threads.find({ threadId: CLOUD_THREAD })).toBeUndefined()
    expect(bridge.destroyed).toEqual([])
  })

  it('still refuses legibly when nothing wakes a parked channel', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    parkedChannel(channel)
    channel.pause = () => undefined

    await expect(
      descend({ bridge, home, channel, pauseDeadlineMs: 20 }),
    ).rejects.toThrow('would not pause in time')

    expect(await home.threads.find({ threadId: CLOUD_THREAD })).toBeUndefined()
    expect(bridge.destroyed).toEqual([])
  })

  it('answers the pause from the attachment the wake installed', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    parkedChannel(channel)
    channel.pause = () => undefined

    await descend({
      bridge,
      home,
      channel,
      wake: async () => {
        channel.pause = () => {
          channel.endTurn({ status: ETurnStatus.RelocationPaused, runId: toRunId('run_woken') })
        }
        channel.moveTo({ state: EChannelConnection.Open, detail: null })
      },
    })

    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Host,
    )
  })
})
