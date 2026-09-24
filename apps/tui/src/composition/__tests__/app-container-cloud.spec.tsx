import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { CloudError, EChannelConnection, ETurnStatus } from '@dltech/atlas-harness'

import { ECloudSandboxState } from '../cloud/cloud-bridge'

import { grammarsReady, settle } from '../../ui/markdown/__tests__/harness'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { promiseGate, until, THREAD } from './app-fixture'
import { mount, speaking } from './app-container-cloud-fixture'
import { FAKE_CONFIG } from './fake-app'
import { fakeAgentSnapshot } from './fake-agents'

await grammarsReady()

type Mounted = Awaited<ReturnType<typeof mount>>

const SEEDED = 'what is in here?'

const nextFrame = async (mounted: Mounted): Promise<string> => {
  try {
    return await mounted.nextFrame()
  } catch (error) {
    if (error instanceof Error && error.message.includes('visual idle')) return ''
    throw error
  }
}

const shown = async (mounted: Mounted, text: string): Promise<string> => {
  const deadline = Date.now() + 20_000
  let frame = ''
  while (Date.now() < deadline) {
    frame = await nextFrame(mounted)
    if (frame.includes(text)) return frame
    await settle(10)
  }
  throw new Error(`waited past 20000 ms for ${JSON.stringify(text)}\n\n${frame}`)
}

const cleared = async (mounted: Mounted, text: string): Promise<string> => {
  const deadline = Date.now() + 20_000
  let frame = ''
  while (Date.now() < deadline) {
    frame = await nextFrame(mounted)
    if (!frame.includes(text)) return frame
    await settle(10)
  }
  throw new Error(`waited past 20000 ms for ${JSON.stringify(text)} to go away\n\n${frame}`)
}

const run = async (mounted: Mounted, argument: string): Promise<void> => {
  await mounted.typeText(`/container ${argument}`)
  mounted.pressEnter()
}

const command = async (mounted: Mounted, text: string): Promise<void> => {
  await mounted.typeText(text)
  mounted.pressEnter()
}

/**
 * The bridge records the attach before the app's lift flow commits its last state update, and the
 * composer stays covered while the move overlay is open (app.tsx gates input on `move !== null`).
 * Typing against the attach alone races that commit on a slow runner — the keystrokes are
 * swallowed by the overlay — so a lift is not done until the overlay has cleared.
 */
const lift = async (mounted: Mounted, bridge: FakeBridge): Promise<void> => {
  await run(mounted, 'cloud')
  expect(await until({ holds: async () => bridge.attached.length === 1, within: 20_000 })).toBe(
    true,
  )
  await cleared(mounted, 'MOVING TO THE CLOUD')
}

describe('/container cloud', () => {
  it('transfers, marks the thread cloud and attaches, carrying the workspace with it', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await run(mounted, 'cloud')
      expect(await until({ holds: async () => bridge.attached.length === 1, within: 20_000 })).toBe(
        true,
      )

      expect(bridge.created).toHaveLength(1)
      expect(bridge.created[0]?.workspace?.branch).toBe('dennis/container-cloud')
      expect(bridge.created[0]?.workspace?.patch).toContain('diff --git')
      expect(bridge.attached).toHaveLength(1)
      expect(app.threads.chosenLocations.at(-1)?.location).toBe(EExecutionLocation.Cloud)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows the cloud pill in the sidebar once attached', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      expect(await shown(mounted, SEEDED)).not.toContain('CLOUD')

      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      expect(await shown(mounted, 'CLOUD')).toContain('CLOUD')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  /**
   * A parked sandbox is stopped, so no frame ever announces the parking: the socket simply stops
   * coming back, and the control plane is the only thing that can tell resting from broken.
   */
  it('renders a parked sandbox as parked rather than as a failure', async () => {
    const app = speaking()
    const bridge = fakeBridge({ status: { state: ECloudSandboxState.Parked } })
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({
        state: EChannelConnection.Closed,
        detail: 'the session socket closed and did not reopen after 8 attempts.',
      })

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
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')

      await bridge.log.append({
        threadId: THREAD,
        runId: toRunId('run-in-the-sandbox'),
        drafts: [{ type: 'user-said', text: landed }],
      })
      const leaked = await until({
        holds: async () => (await nextFrame(mounted)).includes(landed),
        within: 250,
      })
      expect(leaked).toBe(false)

      bridge.channel.reload({ sinceEventSeq: 0 })

      expect(await shown(mounted, landed)).toContain(landed)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('drives the turn on the sandbox after a lift, never on the host', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')

      await mounted.typeText('keep going')
      mounted.pressEnter()
      expect(await until({ holds: async () => bridge.channel.runs === 1, within: 20_000 })).toBe(
        true,
      )

      expect(bridge.channel.runs).toBe(1)
      expect(JSON.stringify(bridge.log.peek({ threadId: THREAD }))).toContain('keep going')
      expect(JSON.stringify(app.log.peek({ threadId: THREAD }))).not.toContain('keep going')

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-1') })
      expect(await shown(mounted, 'keep going')).toContain('keep going')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('still lists the local conversations in /resume after a lift', async () => {
    const app = speaking()
    const other = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    await app.threads.rename({ threadId: other.id, title: 'the host thread' })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      await command(mounted, '/resume')

      expect(await shown(mounted, 'the host thread')).toContain('the host thread')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('reads a 503 as the cloud not being set up and stays on the host', async () => {
    const app = speaking()
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 503, message: 'sandboxes are not configured' }),
    })
    const mounted = await mount({ app, bridge })

    try {
      await run(mounted, 'cloud')
      const frame = await shown(mounted, 'not set up')

      expect(frame).toContain('not set up')
      expect(bridge.attached).toEqual([])
      expect(app.executionLocation.current()).toBe(EExecutionLocation.Host)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('the move overview', () => {
  const gated = (bridge: FakeBridge): { release: () => void } => {
    const { gate, release } = promiseGate()
    const create = bridge.sandboxes.create
    bridge.sandboxes.create = async (args) => {
      await gate
      return create(args)
    }
    return { release }
  }

  it('narrates each step and holds the composer until the sandbox answers', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const { release } = gated(bridge)
    const mounted = await mount({ app, bridge })

    try {
      await run(mounted, 'cloud')
      const moving = await shown(mounted, 'waiting for the sandbox')

      expect(moving).toContain('MOVING TO THE CLOUD')
      expect(moving).toContain('✓ transferring the conversation')
      expect(moving).toContain('waiting for the sandbox')

      await mounted.typeText('typed over the move')
      expect(mounted.draftText()).toBe('')

      release()
      expect(await cleared(mounted, 'MOVING TO THE CLOUD')).not.toContain('MOVING TO THE CLOUD')

      await mounted.typeText('back in command')
      expect(mounted.draftText()).toBe('back in command')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('does not wake a local turn when the move stops a stepping child', async () => {
    const app = speaking()
    app.agents.place(
      fakeAgentSnapshot({
        agentId: 'child-1',
        spawnedBy: THREAD,
        status: EAgentStatus.Running,
      }),
    )
    const bridge = fakeBridge()
    const { release } = gated(bridge)
    const mounted = await mount({ app, bridge })

    try {
      await run(mounted, 'cloud')
      const stopped = await until({ holds: async () => app.agents.stopped.length === 1, within: 20_000 })
      expect(stopped).toBe(true)

      await settle(400)
      expect(app.turnsDriven).toBe(0)

      release()
      expect(await cleared(mounted, 'MOVING TO THE CLOUD')).not.toContain('MOVING TO THE CLOUD')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows the step that failed with the reason, and gives the composer back on esc', async () => {
    const app = speaking()
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity in iad1' }),
    })
    const mounted = await mount({ app, bridge })

    try {
      await run(mounted, 'cloud')
      const failed = await shown(mounted, '✗ waiting for the sandbox')

      expect(failed).toContain('✗ waiting for the sandbox')
      expect(failed).toContain('no capacity in iad1')

      await mounted.typeText('typed over the move')
      expect(mounted.draftText()).toBe('')

      mounted.pressEscape()
      expect(await cleared(mounted, 'MOVING TO THE CLOUD')).not.toContain('MOVING TO THE CLOUD')

      await mounted.typeText('back in command')
      expect(mounted.draftText()).toBe('back in command')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('switching conversations while attached', () => {
  it('starts fresh on the host on /new, releasing the cloud attachment', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      expect(await shown(mounted, 'CLOUD')).toContain('CLOUD')
      const lifted = bridge.channel

      await command(mounted, '/new')

      expect(await until({ holds: async () => lifted.closed, within: 20_000 })).toBe(true)
      expect(await cleared(mounted, 'CLOUD')).not.toContain('CLOUD')

      await mounted.typeText('back on the host')
      mounted.pressEnter()
      expect(await until({ holds: async () => app.turnsDriven === 1, within: 20_000 })).toBe(true)
      expect(app.turnsDriven).toBe(1)
      expect(lifted.runs).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('re-attaches when the cloud conversation is picked back up', async () => {
    const app = speaking()
    const bridge = fakeBridge({
      status: { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' },
    })
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      expect(await shown(mounted, 'CLOUD')).toContain('CLOUD')

      await command(mounted, '/new')
      expect(await cleared(mounted, 'CLOUD')).not.toContain('CLOUD')

      await command(mounted, '/resume opened-thread')

      expect(await until({ holds: async () => bridge.attached.length === 2, within: 20_000 })).toBe(
        true,
      )
      expect(bridge.attached[1]?.threadId).toBe(THREAD)

      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      expect(await shown(mounted, 'CLOUD')).toContain('CLOUD')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('coalesces a burst of reload frames into one trailing re-read', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')

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
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await shown(mounted, 'CLOUD')

      bridge.channel.fail(
        'the workspace failed at git apply: error: patch failed: src/app.ts:12',
      )

      const frame = await shown(mounted, 'git apply')
      expect(frame).toContain('git apply')
      expect(frame).toContain('patch failed')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
