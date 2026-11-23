import { describe, expect, it, mock } from 'bun:test'
import { triggerSdkStub } from '../../../test/trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkStub)

const { threadArchiveCleanupTask } = await import('./thread-archive-cleanup.task')

describe('threadArchiveCleanupTask', () => {
  it('registers thread-archive-cleanup with three attempts and a two minute cap', () => {
    expect(threadArchiveCleanupTask).toMatchObject({
      id: 'thread-archive-cleanup',
      retry: { maxAttempts: 3 },
      maxDuration: 120,
    })
  })
})
