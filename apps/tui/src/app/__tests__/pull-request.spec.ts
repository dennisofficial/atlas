import { describe, expect, test } from 'bun:test'

import { EPullRequestState } from '@dltech/atlas-core'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

import {
  pinnedEntryOf,
  pullRequestChipOf,
  pullRequestEntriesOf,
  pullRequestItemOf,
} from '../pull-request'
import { sessionRowFixture } from './view-fixture'

const URL = 'https://github.com/owner/name/pull/12'

const row = (patch: Partial<StreamSessionRow> = {}): StreamSessionRow =>
  sessionRowFixture({
    pullRequest: {
      repo: 'owner/name',
      number: 12,
      url: URL,
      state: EPullRequestState.Open,
      checks: { running: 0, passed: 1, failed: 2 },
      mergeable: true,
    },
    ...patch,
  })

const linked = (
  patch: Partial<{ branch: string; failed: number; passed: number; running: number }> = {},
) => ({
  repo: 'owner/name',
  number: 12,
  url: URL,
  branch: patch.branch ?? 'feat/x',
  state: {
    title: 'the change',
    state: EPullRequestState.Open,
    headSha: 'abc',
    checks: {
      running: patch.running ?? 0,
      passed: patch.passed ?? 3,
      failed: patch.failed ?? 0,
    },
    mergeable: true,
    updatedAt: '2026-11-20T00:00:00.000Z',
  },
})

describe('pull request entries', () => {
  test('the row stub and the linked entry merge', () => {
    const entries = pullRequestEntriesOf({ row: row(), linked: [linked()], branch: 'feat/x' })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      number: 12,
      branch: 'feat/x',
      current: true,
      checks: { passed: 3, failed: 0 },
    })
  })

  test('a failing check outranks an open state in the chip', () => {
    const entries = pullRequestEntriesOf({ row: row(), linked: [], branch: null })
    expect(pullRequestChipOf(entries[0]!)).toEqual({
      spans: [{ text: '#12', fg: '#282422' }],
      ground: '#e5534b',
    })
  })

  test('the pinned entry is the current branch', () => {
    const entries = pullRequestEntriesOf({
      row: row(),
      linked: [linked(), linked({ branch: 'main' })],
      branch: 'main',
    })
    expect(pinnedEntryOf(entries)?.branch).toBe('main')
  })

  test('activating the pill opens its url and carries the overflow', () => {
    const opened: string[] = []
    const entries = pullRequestEntriesOf({
      row: row(),
      linked: [linked(), linked({ branch: 'main' })],
      branch: 'feat/x',
    })
    const item = pullRequestItemOf({
      entry: pinnedEntryOf(entries)!,
      overflow: entries.length - 1,
      onOpen: (url) => opened.push(url),
    })

    item.onActivate?.()

    expect(opened).toEqual([URL])
    expect(item.spans[0]?.text).toBe('#12 +1')
  })
})
