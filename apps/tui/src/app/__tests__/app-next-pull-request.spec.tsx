import { describe, expect, test } from 'bun:test'

import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { GITHUB_PROVIDER } from '@dltech/atlas-plugin-github/core'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'
import { sessionRowFixture, viewFixture } from './view-fixture'

const URL = 'https://github.com/owner/name/pull/12'

const ROW: StreamSessionRow = sessionRowFixture({
  pullRequest: {
    repo: 'owner/name',
    number: 12,
    url: URL,
    state: 'open',
    checks: null,
    mergeable: true,
  },
})

const SUBSCRIPTION = {
  id: 'sub-1',
  threadId: SESSION_ID,
  provider: GITHUB_PROVIDER,
  target: { repo: 'github.com/owner/name', number: 12 },
  label: '',
  events: [],
  createdBy: 'operator',
  createdAt: '2026-11-20T00:00:00.000Z',
}

describe('the pull request pill and bell', () => {
  test('shows the pill and the bell fills once subscribed', async () => {
    const mounted = await openSession({ rows: [ROW] })

    try {
      const frame = await frameShowing({ setup: mounted.setup, text: '#12', within: WITHIN })
      expect(frame).toContain('○')

      mounted.client()?.pushEvents({
        sessionId: SESSION_ID,
        events: mintEvents({ bodies: [{ type: 'user-said', text: 'watch it' }] }),
        live: true,
      })
      mounted.client()?.pushView({
        sessionId: SESSION_ID,
        view: viewFixture({ at: 500, subscriptions: [SUBSCRIPTION] }),
      })
      await frameWhen({
        setup: mounted.setup,
        holds: (next) => next.includes('#12') && !next.includes('○'),
        within: WITHIN,
        describe: 'the filled bell',
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
