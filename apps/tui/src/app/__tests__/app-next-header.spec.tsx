import { describe, expect, test } from 'bun:test'

import { mintEvents } from '@dltech/atlas-client/stream-fixture'
import { EChangeFileStatus } from '@dltech/atlas-protocol'

import { frameShowing } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'

const CHECKOUT = {
  checkoutId: 'co-1',
  repo: 'owner/name',
  worktreePath: '/work/name',
  base: null,
  updatedAt: 1,
  files: [
    {
      path: 'a.ts',
      oldPath: null,
      status: EChangeFileStatus.Modified,
      additions: 10,
      deletions: 2,
      binary: false,
      size: null,
      baseHash: null,
      currentHash: null,
    },
    {
      path: 'b.ts',
      oldPath: null,
      status: EChangeFileStatus.Added,
      additions: 2,
      deletions: 1,
      binary: false,
      size: null,
      baseHash: null,
      currentHash: null,
    },
  ],
}

const BRANCHES = mintEvents({
  bodies: [
    {
      type: 'branches-observed',
      repo: 'owner/name',
      head: 'main',
      base: 'main',
      branches: [{ name: 'main', sha: 'abc123' }],
      worktrees: [],
    },
  ],
})

describe('the header', () => {
  test('shows the repo and the diff stat', async () => {
    const mounted = await openSession({
      configure: (client) => client.pushChanges({ checkouts: [CHECKOUT] }),
    })

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: BRANCHES, live: true })

      const frame = await frameShowing({ setup: mounted.setup, text: '+12', within: WITHIN })
      expect(frame).toContain('name')
      expect(frame).toContain('-3')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('a refused change set leaves the header without a stat', async () => {
    const mounted = await openSession({
      configure: (client) => client.refuseChanges(503),
    })

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: BRANCHES, live: true })

      const frame = await frameShowing({ setup: mounted.setup, text: 'esc back', within: WITHIN })
      expect(frame).not.toContain('+12')
      expect(frame).toContain('the open session')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
