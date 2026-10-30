import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { dismissRunFailure } from '../dismiss-run-failure'

describe('dismissRunFailure', () => {
  it('appends one run-failure-dismissed draft naming the failure seq', async () => {
    const appended: EventDraft[] = []
    await dismissRunFailure({
      log: {
        append: async ({ drafts }) => {
          appended.push(...drafts)
          return []
        },
      },
      threadId: toThreadId('t'),
      runId: toRunId('r'),
      failureSeq: 4,
    })
    expect(appended).toEqual([{ type: 'run-failure-dismissed', failureSeq: 4 }])
  })
})
