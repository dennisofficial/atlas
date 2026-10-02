import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { CloudError, ECloudSandboxState, EChannelConnection, ERuntimeKind } from '@dltech/atlas-harness'

import { grammarsReady, settle } from '../../ui/markdown/__tests__/harness'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { until } from './app-fixture'
import { mount, speaking } from './app-container-cloud-fixture'

await grammarsReady()

type Mounted = Awaited<ReturnType<typeof mount>>

const shown = async (mounted: Mounted, text: string): Promise<string> => {
  const deadline = Date.now() + 20_000
  let frame = ''
  while (Date.now() < deadline) {
    frame = await mounted.nextFrame().catch(() => '')
    if (frame.includes(text)) return frame
    await settle(10)
  }
  throw new Error(`waited past 20000 ms for ${JSON.stringify(text)}\n\n${frame}`)
}

const cleared = async (mounted: Mounted, text: string): Promise<string> => {
  const deadline = Date.now() + 20_000
  let frame = ''
  while (Date.now() < deadline) {
    frame = await mounted.nextFrame().catch(() => '')
    if (!frame.includes(text)) return frame
    await settle(10)
  }
  throw new Error(`waited past 20000 ms for ${JSON.stringify(text)} to go away\n\n${frame}`)
}

const lift = async (mounted: Mounted, bridge: FakeBridge): Promise<void> => {
  await mounted.run('cloud')
  expect(await until({ holds: async () => bridge.attached.length === 1, within: 20_000 })).toBe(true)
  await cleared(mounted, 'MOVING TO THE CLOUD')
}

describe('the session owner behind /container', () => {
  it('keeps the local runner and host pill after a failed lift, then switches both on the retry', async () => {
    const app = speaking()
    const local = app.sessionOwner.require()
    const bridge = fakeBridge()
    const create = bridge.sandboxes.create
    let failures = 1
    bridge.sandboxes.create = async (given) => {
      if (failures === 0) return create(given)
      failures -= 1
      throw new CloudError({ status: 503, message: 'sandboxes are not configured' })
    }
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')
      await shown(mounted, 'not set up')
      const failed = app.sessionOwner.snapshot()
      expect(failed.location).toBe(EExecutionLocation.Host)
      expect(failed.binding).toBe(local)
      expect(failed.binding?.adapters.runner).toBe(app.runner)
      expect(failed.bound).toBe(true)
      expect(bridge.attached).toEqual([])

      mounted.pressEscape()
      await cleared(mounted, 'MOVING TO THE CLOUD')
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      const lifted = app.sessionOwner.snapshot()
      expect(lifted.location).toBe(EExecutionLocation.Cloud)
      expect(lifted.binding?.kind).toBe(ERuntimeKind.Cloud)
      expect(lifted.binding).not.toBe(local)
      expect(lifted.binding?.adapters.runner).not.toBe(app.runner)
      expect(lifted.binding?.adapters.channel).toBe(bridge.channel)
      expect(await shown(mounted, 'CLOUD')).toContain('CLOUD')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('selects the cloud runner only with the cloud placement and the local runner again once home', async () => {
    const app = speaking()
    const local = app.sessionOwner.require()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')
      const cloud = app.sessionOwner.snapshot()
      expect(cloud.binding?.kind).toBe(ERuntimeKind.Cloud)
      expect(cloud.cwd).not.toBe(local.cwd)

      await mounted.run('host')
      await cleared(mounted, 'MOVING BACK TO THE HOST')
      const home = app.sessionOwner.snapshot()
      expect(home.location).toBe(EExecutionLocation.Host)
      expect(home.bound).toBe(true)
      expect(home.binding?.kind).toBe(ERuntimeKind.Local)
      expect(home.binding?.adapters.runner).toBe(app.runner)
      expect(home.cwd).toBe(local.cwd)
      expect(app.sessionOwner.require()).toBe(home.binding as NonNullable<typeof home.binding>)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('moves /container off from cloud through the owner, not a lifted flag', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')
      expect(app.sessionOwner.snapshot().location).toBe(EExecutionLocation.Cloud)

      await mounted.run('off')
      await cleared(mounted, 'MOVING BACK TO THE HOST')
      expect(app.sessionOwner.snapshot().location).toBe(EExecutionLocation.Host)
      expect(app.executionLocation.current()).toBe(EExecutionLocation.Host)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('anchors the cloud runtime on the sandbox workspace, never this machine', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')
      const cloud = app.sessionOwner.snapshot()
      expect(cloud.location).toBe(EExecutionLocation.Cloud)
      expect(cloud.cwd).not.toBe(app.workspace.workspace)
      expect(cloud.binding?.adapters.workspace.workspace).toBe(cloud.cwd)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('answers a bare /container from the owner without waking the sandbox or recovering', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')
      const attached = bridge.attached.length
      const created = bridge.created.length

      await mounted.run('')
      expect(bridge.attached.length).toBe(attached)
      expect(bridge.created.length).toBe(created)
      expect(app.sessionOwner.snapshot().location).toBe(EExecutionLocation.Cloud)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the sandbox attached, then reattaches from the picker, when /new left the cloud thread behind', async () => {
    const app = speaking()
    const bridge = fakeBridge({
      status: { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' },
    })
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')
      const cloudThread = app.sessionOwner.snapshot().threadId

      await mounted.command('/new')
      await cleared(mounted, 'CLOUD')
      const fresh = app.sessionOwner.snapshot()
      expect(fresh.location).toBe(EExecutionLocation.Host)
      expect(fresh.binding?.kind).toBe(ERuntimeKind.Local)
      expect(fresh.threadId).not.toBe(cloudThread)

      await mounted.command('/resume opened-thread')
      expect(await until({ holds: async () => bridge.attached.length === 2, within: 20_000 })).toBe(true)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')
      const back = app.sessionOwner.snapshot()
      expect(back.threadId).toBe(cloudThread)
      expect(back.binding?.kind).toBe(ERuntimeKind.Cloud)
      expect(back.bound).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
