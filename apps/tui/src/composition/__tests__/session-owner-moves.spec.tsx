import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { ECloudSandboxState, EChannelConnection, ERuntimeKind } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { until } from './app-fixture'
import { cleared, mountInCloud, shown, speaking } from './app-container-cloud-fixture'

await grammarsReady()

const connected = async (mounted: Awaited<ReturnType<typeof mountInCloud>>, bridge: ReturnType<typeof fakeBridge>) => {
  bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
  await shown(mounted, 'CLOUD')
}

describe('the session owner behind a cloud thread', () => {
  it('selects the cloud runner for a cloud-born thread, not the local one', async () => {
    const app = speaking()
    const local = app.sessionOwner.require()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)
      const cloud = app.sessionOwner.snapshot()
      expect(cloud.location).toBe(EExecutionLocation.Cloud)
      expect(cloud.binding?.kind).toBe(ERuntimeKind.Cloud)
      expect(cloud.binding).not.toBe(local)
      expect(cloud.binding?.adapters.runner).not.toBe(app.runner)
      expect(cloud.binding?.adapters.channel).toBe(bridge.channel)
      expect(cloud.cwd).not.toBe(local.cwd)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('anchors the cloud runtime on the sandbox workspace, never this machine', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)
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
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)
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
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)
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

describe.skip('the session owner behind /container moves', () => {
  // slice 08: both cases drive the lift (a failed then retried /container cloud) or the descend
  // (/container off|host) through the owner, and /container no longer moves threads.
  it('keeps the local runner and host pill after a failed lift, then switches both on the retry', () => {})
  it('returns to the local runner once home after a descend, and moves /container off through the owner', () => {})
})
