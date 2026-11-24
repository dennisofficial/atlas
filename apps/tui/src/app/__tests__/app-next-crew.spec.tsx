import { describe, expect, test } from 'bun:test'

import { EAgentStatus, EAgentStart, toThreadId } from '@dltech/atlas-core'
import { headOf, mintEvents } from '@dltech/atlas-client/stream-fixture'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'

const AGENT_ID = toThreadId('agent-1')

const SPAWNED = mintEvents({
  bodies: [
    {
      type: 'agent-spawned',
      agentId: AGENT_ID,
      agentType: 'general-purpose',
      intent: 'read the tracing tree',
      mode: EAgentStart.Fresh,
    },
  ],
})

const ENDED = mintEvents({
  bodies: [
    {
      type: 'agent-ended',
      agentId: AGENT_ID,
      agentType: 'general-purpose',
      intent: 'read the tracing tree',
      status: EAgentStatus.Finished,
      prose: 'read three files',
      turns: 2,
      toolCalls: 7,
    },
  ],
  from: headOf(SPAWNED),
})

const ON_CHILD = 'back to main agent'

const openChild = async (mounted: Awaited<ReturnType<typeof openSession>>): Promise<string> => {
  mounted.setup.mockInput.pressKey('g', { ctrl: true })

  return frameWhen({
    setup: mounted.setup,
    holds: (frame) => frame.includes(ON_CHILD),
    within: WITHIN,
    describe: 'the child transcript',
  })
}

describe('walking into a sub-agent', () => {
  test('esc leaves a settled sub-agent and comes back to the parent', async () => {
    const mounted = await openSession()

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SPAWNED, live: true })
      await frameShowing({ setup: mounted.setup, text: 'read the tracing tree', within: WITHIN })
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: ENDED, live: true })

      const child = await openChild(mounted)
      expect(child).not.toContain('the open session')

      mounted.setup.mockInput.pressEscape()

      const parent = await frameWhen({
        setup: mounted.setup,
        holds: (frame) => frame.includes('Steer the turn') && !frame.includes(ON_CHILD),
        within: WITHIN,
        describe: 'the parent transcript',
      })
      expect(parent).toContain('the open session')
      expect(mounted.client()?.calls.runCommand).toHaveLength(0)
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('esc arms the stop of a live sub-agent, and esc again stops it', async () => {
    const mounted = await openSession()

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SPAWNED, live: true })

      await frameShowing({ setup: mounted.setup, text: 'read the tracing tree', within: WITHIN })
      await openChild(mounted)

      mounted.setup.mockInput.pressEscape()

      await frameShowing({
        setup: mounted.setup,
        text: `esc again to stop ${AGENT_ID}`,
        within: WITHIN,
      })
      expect(mounted.client()?.calls.runCommand).toHaveLength(0)

      mounted.setup.mockInput.pressEscape()

      await frameWhen({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.runCommand.length ?? 0) > 0,
        within: WITHIN,
        describe: 'the stop command',
      })
      expect(mounted.client()?.calls.runCommand).toEqual([
        { sessionId: SESSION_ID, name: 'agent', args: { action: 'stop', agentId: AGENT_ID } },
      ])
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
