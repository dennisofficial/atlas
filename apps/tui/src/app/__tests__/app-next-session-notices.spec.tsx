import { describe, expect, test } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'
import { sessionRowFixture } from './view-fixture'

const OTHER = 'session-two'

const other = (state?: ESessionStatus): StreamSessionRow =>
  sessionRowFixture({
    sessionId: OTHER,
    mainThreadId: 'thread-2',
    title: 'the other session',
    ...(state === undefined ? {} : { status: { state } }),
  })

const open = (state?: ESessionStatus): StreamSessionRow =>
  sessionRowFixture({
    sessionId: SESSION_ID,
    title: 'the open session',
    ...(state === undefined ? {} : { status: { state } }),
  })

describe('notices for other sessions', () => {
  test('a sibling finishing is announced, the open session is not', async () => {
    const mounted = await openSession({ rows: [open(), other()] })

    try {
      mounted.client()?.pushRows([open(ESessionStatus.Thinking), other(ESessionStatus.Thinking)])
      await frameShowing({ setup: mounted.setup, text: 'esc back', within: WITHIN })

      mounted.client()?.pushRows([open(ESessionStatus.Thinking), other(ESessionStatus.Idle)])
      const notice = await frameWhen({
        setup: mounted.setup,
        holds: (frame) => frame.includes('the other session finished'),
        within: WITHIN,
        describe: 'the sibling notice',
      })
      expect(notice).not.toContain('the open session finished')

      mounted.client()?.pushRows([open(ESessionStatus.Idle), other(ESessionStatus.Idle)])
      await frameShowing({ setup: mounted.setup, text: 'esc back', within: WITHIN })
      expect(mounted.setup.captureCharFrame()).not.toContain('the open session finished')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
