import { afterEach, describe, expect, it } from 'bun:test'
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React, { act } from 'react'

import { EExecutionLocation, toRunId, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState, EChannelConnection, ERuntimeKind, type CloudConnection } from '@dltech/atlas-harness'

import { grammarsReady, settle } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { clearAttachFailure, recordAttachFailure } from '../attach-failure'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { useCloudConnection } from '../use-cloud-connection'
import { mountCloud } from './app-cloud-archive-fixture'
import { THREAD, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

await grammarsReady()

afterEach(() => {
  dismissNotice()
  clearAttachFailure()
})

const REASON = 'the sandbox could not wake'

const RUNNING = { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' } as const

const appFor = (): FakeApp => fakeApp({ model: scriptedModelPort({ script: { thinking: 'a', reply: 'b' } }) })

const failingOnce = async (app: FakeApp) => {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.chooseExecutionLocation({ threadId: thread.id, location: EExecutionLocation.Cloud })
  await app.threads.rename({ threadId: thread.id, title: 'the lifted thread' })
  const bridge: FakeBridge = fakeBridge({ status: RUNNING })
  await bridge.log.append({
    threadId: thread.id,
    runId: toRunId('run-cloud'),
    drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
  })
  const create = bridge.sandboxes.create
  const wakes = { failures: 1 }
  bridge.sandboxes.create = async (given) => {
    if (wakes.failures === 0) return create(given)
    wakes.failures -= 1
    throw new Error(REASON)
  }
  return { threadId: thread.id, bridge, wakes }
}

const apologised = (): boolean => currentNotices().some((notice) => notice.text.includes(REASON))

describe('a boot attach that fails because the sandbox would not wake', () => {
  it('leaves the owner on an unbound cloud placement and the chrome closed, never connecting', async () => {
    const app = appFor()
    const { threadId, bridge, wakes } = await failingOnce(app)
    const mounted = await mountCloud({
      app,
      bridge,
      withArchive: false,
      opened: { threadId: THREAD, events: [], turns: [], name: null, started: false, bootCloudThreadId: threadId },
    })

    try {
      expect(await until({ holds: async () => wakes.failures === 0 && apologised(), within: 10_000 })).toBe(true)
      mounted.pressEscape()
      await settle(300)
      const frame = await mounted.showing('✗ cloud')
      expect(frame).not.toContain('WAKING THE SANDBOX')

      const owner = app.sessionOwner.snapshot()
      expect(owner.location).toBe(EExecutionLocation.Cloud)
      expect(owner.bound).toBe(false)
      expect(owner.binding).toBeUndefined()
      expect(owner.threadId).toBe(threadId)
      expect(bridge.attached).toEqual([])

      await settle(1_000)
      const later = await mounted.nextFrame()
      expect(later).toContain('✗ cloud')
      expect(later).not.toContain('connecting')
      expect(app.sessionOwner.snapshot().bound).toBe(false)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('offers a reconnect on the transcript that attaches once clicked', async () => {
    const app = appFor()
    const { threadId, bridge, wakes } = await failingOnce(app)
    const mounted = await mountCloud({ app, bridge, withArchive: false })

    try {
      await mounted.command('/resume')
      await mounted.command('lifted')
      await mounted.command('')
      expect(await until({ holds: async () => wakes.failures === 0 && apologised(), within: 10_000 })).toBe(true)
      mounted.pressEscape()
      await settle(300)

      const failed = await mounted.showing('○ disconnected')
      expect(failed).toContain('✗ closed')
      expect(failed).toContain('✗ cloud')
      expect(app.sessionOwner.snapshot().bound).toBe(false)
      expect(bridge.attached).toEqual([])

      const lines = failed.split('\n')
      const row = lines.findIndex((line) => line.includes('ctrl+r reconnect'))
      expect(row).toBeGreaterThanOrEqual(0)
      await mounted.click({ x: (lines[row] ?? '').indexOf('reconnect') + 2, y: row })

      expect(await until({ holds: async () => bridge.attached.length === 1, within: 20_000 })).toBe(true)
      const attached = await mounted.showing('said inside the sandbox')
      expect(attached).not.toContain('○ disconnected')
      const owner = app.sessionOwner.snapshot()
      expect(owner.bound).toBe(true)
      expect(owner.threadId).toBe(threadId)
      expect(owner.binding?.kind).toBe(ERuntimeKind.Cloud)
      expect(bridge.attached[0]?.threadId).toBe(threadId)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('the reconnect the transcript advertises on a failed attach', () => {
  it('attaches when ctrl+r is pressed', async () => {
    const app = appFor()
    const { threadId, bridge, wakes } = await failingOnce(app)
    const mounted = await mountCloud({ app, bridge, withArchive: false })

    try {
      await mounted.command('/resume')
      await mounted.command('lifted')
      await mounted.command('')
      expect(await until({ holds: async () => wakes.failures === 0 && apologised(), within: 10_000 })).toBe(true)
      mounted.pressEscape()
      await settle(300)
      const failed = await mounted.showing('ctrl+r reconnect')
      expect(failed).toContain('✗ cloud')
      expect(bridge.attached).toEqual([])

      mounted.pressCtrl('r')

      expect(await until({ holds: async () => bridge.attached.length === 1, within: 5_000 })).toBe(true)
      expect(await until({ holds: async () => app.sessionOwner.snapshot().bound, within: 20_000 })).toBe(true)
      expect(bridge.attached[0]?.threadId).toBe(threadId)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

type Probe = { current: CloudConnection | null | undefined }

const OTHER: ThreadId = toThreadId('some-other-thread')

describe('the connection the chrome derives from a recorded attach failure', () => {
  let setup: TestRendererSetup | undefined

  afterEach(() => {
    setup?.renderer.destroy()
    setup = undefined
  })

  const mountProbe = async (): Promise<{ probe: Probe; app: FakeApp }> => {
    const app = appFor()
    await app.threads.create({ id: THREAD, executionLocation: EExecutionLocation.Cloud })
    await app.executionLocation.activate({ threadId: THREAD, fallback: EExecutionLocation.Cloud })
    const probe: Probe = { current: undefined }
    function Harness() {
      probe.current = useCloudConnection({ app, session: null })
      return <box />
    }
    setup = await createTestRenderer({ width: 40, height: 4 })
    const root = createRoot(setup.renderer)
    await act(async () => {
      root.render(<Harness />)
      await setup?.flush()
    })
    return { probe, app }
  }

  it('is closed with the reason for the failed thread, and connecting for any other or once cleared', async () => {
    const { probe, app } = await mountProbe()
    expect(app.sessionOwner.snapshot().bound).toBe(false)
    expect(probe.current?.state).toBe(EChannelConnection.Connecting)

    await act(async () => recordAttachFailure({ threadId: OTHER, detail: REASON }))
    expect(probe.current?.state).toBe(EChannelConnection.Connecting)

    await act(async () => recordAttachFailure({ threadId: THREAD, detail: REASON }))
    expect(probe.current).toEqual({ state: EChannelConnection.Closed, detail: REASON })

    await act(async () => clearAttachFailure())
    expect(probe.current?.state).toBe(EChannelConnection.Connecting)
  })
})
