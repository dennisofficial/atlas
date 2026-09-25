import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EShellStatus,
  toThreadId,
  type RosterWire,
} from '@dltech/atlas-core'
import { EChannelConnection, toShellId } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { until, THREAD } from './app-fixture'
import { mount, speaking } from './app-container-cloud-fixture'

await grammarsReady()

type Mounted = Awaited<ReturnType<typeof mount>>

const shown = async (mounted: Mounted, text: string): Promise<string> => {
  const deadline = Date.now() + 20_000
  let frame = ''
  while (Date.now() < deadline) {
    frame = await mounted.nextFrame()
    if (frame.includes(text)) return frame
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`waited past 20000 ms for ${JSON.stringify(text)}\n\n${frame}`)
}

const lift = async (mounted: Mounted, bridge: ReturnType<typeof fakeBridge>): Promise<void> => {
  await mounted.run('cloud')
  expect(await until({ holds: async () => bridge.attached.length === 1, within: 20_000 })).toBe(
    true,
  )
  bridge.channel.pushRoster(rosterWithShell)
  await new Promise((resolve) => setTimeout(resolve, 500))
  bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
}

const rosterWithShell: RosterWire = {
  shells: [
    {
      shellId: toShellId('bash_1'),
      threadId: THREAD,
      command: 'bun run dev',
      description: 'dev server',
      status: EShellStatus.Running,
      startedAt: '2026-09-24T10:00:00.000Z',
      lastOutputAt: '2026-09-24T10:00:01.000Z',
      totalCharacters: 64,
      awaitingInput: false,
    },
  ],
  agents: [
    {
      agentId: toThreadId('child-explore'),
      spawnedBy: THREAD,
      agentType: 'explore',
      intent: 'map the seam',
      status: EAgentStatus.Running,
      turns: 1,
      toolCalls: 3,
      lastTool: undefined,
      startedAt: '2026-09-24T10:00:00.000Z',
      endedAt: undefined,
    },
  ],
  services: [],
}

describe('a cloud session renders the remote roster', () => {
  it('shows the sandbox’s running shell in the sidebar after a roster push', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)

      const frame = await shown(mounted, 'dev server')
      expect(frame).toContain('SHELLS')
      expect(frame).toContain('dev server')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows the sandbox’s sub-agent in the crew after a roster push', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await lift(mounted, bridge)

      const frame = await shown(mounted, 'map the seam')
      expect(frame).toContain('map the seam')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
