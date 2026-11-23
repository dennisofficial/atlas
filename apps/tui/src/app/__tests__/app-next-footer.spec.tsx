import { describe, expect, test } from 'bun:test'

import { mintEvents } from '@dltech/atlas-client/stream-fixture'
import { ESessionStatus } from '@dltech/atlas-core'

import { frameShowing } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'
import { viewFixture } from './view-fixture'

const LEASE = { epoch: 1, holderHostId: 7, live: true }

const READING = mintEvents({
  bodies: [
    {
      type: 'assistant-said',
      parts: [{ type: 'text', text: 'hello' }],
      usage: {
        inputTokens: 40_000,
        outputTokens: 10_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        contextWindow: 200_000,
      },
    },
  ],
})

describe('the footer', () => {
  test('shows the model, effort, context, spend and pod', async () => {
    const mounted = await openSession()

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: READING, live: true })
      mounted.client()?.pushView({
        sessionId: SESSION_ID,
        view: viewFixture({
          status: {
            state: ESessionStatus.Idle,
            lease: LEASE,
            pod: { phase: 'steady', actualVcpus: 8 },
          },
          spend: {
            rows: [],
            tally: {
              inputTokens: 1_000,
              outputTokens: 500,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              uncachedInputTokens: 0,
              costUsd: 1.25,
            },
          },
        }),
      })

      const frame = await frameShowing({ setup: mounted.setup, text: '8 vCPU', within: WITHIN })
      expect(frame).toContain('claude-sonnet-4-5')
      expect(frame).toContain('high')
      expect(frame).toContain('25%')
      expect(frame).toContain('↑ 1.0k')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
