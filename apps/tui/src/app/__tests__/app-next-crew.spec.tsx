import { describe, expect, test } from 'bun:test'

import { EAgentStart, toThreadId } from '@dltech/atlas-core'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'
const SPAWNED = mintEvents({
  bodies: [
    {
      type: 'agent-spawned',
      agentId: toThreadId('agent-1'),
      agentType: 'general-purpose',
      intent: 'read the tracing tree',
      mode: EAgentStart.Fresh,
    },
  ],
})

describe('walking into a sub-agent', () => {
  test('ctrl+g opens its transcript, and esc keeps the sub-agent on screen to stop', async () => {
    const mounted = await openSession()

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SPAWNED, live: true })

      await frameShowing({ setup: mounted.setup, text: 'read the tracing tree', within: WITHIN })

      mounted.setup.mockInput.pressKey('g', { ctrl: true })

      const child = await frameWhen({
        setup: mounted.setup,
        holds: (frame) => frame.includes('back to main agent'),
        within: WITHIN,
        describe: 'the child transcript',
      })
      expect(child).not.toContain('the open session')

      mounted.setup.mockInput.pressEscape()

      const kept = await frameWhen({
        setup: mounted.setup,
        holds: (frame) => frame.includes('back to main agent'),
        within: WITHIN,
        describe: 'the sub-agent to stay on screen',
      })
      expect(kept).toContain('read the tracing tree')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
