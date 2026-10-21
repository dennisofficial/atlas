import { describe, expect, it } from 'vitest'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { ECloudSandboxState, EConnectionView, ERuntimePhase, ETurnStatus, transcriptIdentityDigest } from '@dltech/atlas-harness'

import { grammarsReady, settle } from '../../ui/markdown/__tests__/harness'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { promiseGate, until, THREAD } from './app-fixture'
import {
  cleared,
  mountInCloud,
  nextFrameOf,
  shown,
  speaking,
} from './app-container-cloud-fixture'
import { FAKE_CONFIG } from './fake-app'

await grammarsReady()

type Mounted = Awaited<ReturnType<typeof mountInCloud>>

const SEEDED = 'what is in here?'

const command = async (mounted: Mounted, text: string): Promise<void> => {
  await mounted.typeText(text)
  mounted.pressEnter()
}

const connected = async (mounted: Mounted, bridge: ReturnType<typeof fakeBridge>): Promise<void> => {
  bridge.channel.moveTo({ state: EConnectionView.Connected, detail: null })
  await shown(mounted, 'CLOUD')
}

describe('a thread born in the cloud', () => {
  it('attaches at boot to the sandbox and marks the thread cloud', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      expect(bridge.attached).toHaveLength(1)
      expect(bridge.attached[0]?.threadId).toBe(THREAD)
      expect((await app.threads.find({ threadId: THREAD }))?.executionLocation).toBe(EExecutionLocation.Cloud)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows the cloud pill in the sidebar once attached', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      bridge.channel.moveTo({ state: EConnectionView.Connected, detail: null })

      expect(await shown(mounted, 'CLOUD')).toContain('CLOUD')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('renders no relocation divider once attached — a born-placed thread never moved', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)

      expect(await cleared(mounted, 'cloud sandbox')).not.toContain('cloud sandbox')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the typed draft across a reload, which remounts the workspace', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)
      await mounted.typeText('still thinking about the auth seam')
      expect(await nextFrameOf(mounted)).toContain('still thinking about the auth seam')

      bridge.channel.reload({ sinceEventSeq: 0 })
      await settle(400)

      expect(mounted.draftText()).toBe('still thinking about the auth seam')
      expect(await shown(mounted, 'CLOUD')).toContain('still thinking about the auth seam')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('renders a parked sandbox as parked rather than as a failure', async () => {
    const app = speaking()
    const bridge = fakeBridge({
      status: { state: ECloudSandboxState.Parked, sandboxSessionId: 'session-1' },
      checkpoint: {
        threadId: THREAD,
        runtimeId: 'runtime-1',
        sandboxSessionId: 'session-1',
        revision: 1,
        phase: ERuntimePhase.Parked,
        reportedAt: '2026-10-01T00:00:00.000Z',
        transcript: { head: 0, count: 0, digest: transcriptIdentityDigest([]) },
      },
    })
    const mounted = await mountInCloud({ app, bridge })

    try {
      bridge.channel.moveTo({ state: EConnectionView.Parked, detail: null })

      const frame = await shown(mounted, 'parked')
      expect(frame).toContain('parked')
      expect(frame).toContain('☾')
      expect(frame).not.toContain('asleep until the next message')
      expect(frame).not.toContain('the cloud sandbox is parked')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('re-reads the durable log when the channel cannot resume its delta buffer', async () => {
    const landed = 'the sandbox wrote this while the socket was away'
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)

      await bridge.log.append({
        threadId: THREAD,
        runId: toRunId('run-in-the-sandbox'),
        drafts: [{ type: 'user-said', text: landed }],
      })
      const leaked = await until({
        holds: async () => (await nextFrameOf(mounted)).includes(landed),
        within: 250,
      })
      expect(leaked).toBe(false)

      bridge.channel.reload({ sinceEventSeq: 0 })

      expect(await shown(mounted, landed)).toContain(landed)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('drives the turn on the sandbox, never on the host', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)

      await mounted.typeText('keep going')
      mounted.pressEnter()
      expect(
        await until({
          holds: async () => bridge.channel.sent.some((said) => said.text === 'keep going'),
          within: 20_000,
        }),
      ).toBe(true)

      expect(JSON.stringify(bridge.log.peek({ threadId: THREAD }))).toContain('keep going')
      expect(JSON.stringify(app.log.peek({ threadId: THREAD }))).not.toContain('keep going')

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-1') })
      expect(await shown(mounted, 'keep going')).toContain('keep going')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('still lists the local conversations in /resume', async () => {
    const app = speaking()
    const other = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    await app.threads.rename({ threadId: other.id, title: 'the host thread' })
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await shown(mounted, SEEDED)
      await command(mounted, '/resume')

      expect(await shown(mounted, 'the host thread')).toContain('the host thread')
    } finally {
      await mounted.done()
    }
  }, 60_000)

})

describe('switching conversations while attached', () => {
  it('starts a fresh pod thread on /new, releasing the cloud attachment', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)
      const attached = bridge.channel

      await command(mounted, '/new')

      expect(await until({ holds: async () => attached.closed, within: 20_000 })).toBe(true)
      expect(await cleared(mounted, 'CLOUD')).not.toContain('CLOUD')

      expect(attached.runs).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('re-attaches when the cloud conversation is picked back up', async () => {
    const app = speaking()
    const bridge = fakeBridge({ status: { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' } })
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)

      await command(mounted, '/new')
      expect(await cleared(mounted, 'CLOUD')).not.toContain('CLOUD')

      await command(mounted, '/resume opened-thread')

      expect(
        await until({ holds: async () => bridge.attached.some((held) => held.threadId === THREAD && held !== bridge.attached[0]), within: 20_000 }),
      ).toBe(true)

      bridge.channel.moveTo({ state: EConnectionView.Connected, detail: null })
      expect(await shown(mounted, 'CLOUD')).toContain('CLOUD')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('coalesces a burst of reload frames into one trailing re-read', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)

      const { gate, release } = promiseGate()
      const original = bridge.log.read.bind(bridge.log)
      let reads = 0
      bridge.log.read = async (args: Parameters<typeof bridge.log.read>[0]) => {
        reads += 1
        await gate
        return original(args)
      }

      bridge.channel.reload({ sinceEventSeq: 0 })
      bridge.channel.reload({ sinceEventSeq: 0 })
      bridge.channel.reload({ sinceEventSeq: 0 })
      release()
      expect(await until({ holds: async () => reads === 2, within: 20_000 })).toBe(true)
      await settle(250)

      expect(reads).toBe(2)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('a sandbox whose workspace would not materialise', () => {
  it('renders the git step and git’s own words rather than an empty directory', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      await connected(mounted, bridge)

      bridge.channel.fail('the workspace failed at git apply: error: patch failed: src/app.ts:12')

      const frame = await shown(mounted, 'git apply')
      expect(frame).toContain('git apply')
      expect(frame).toContain('patch failed')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
