import { describe, expect, it, mock } from 'bun:test'
import { triggerSdkStub } from '../../../test/trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkStub)

const { githubV1WakeSweepTask } = await import('./github-v1-wake-sweep.task')

describe('github v1 wake sweep task', () => {
  it('registers the v1 effects drain every minute with three attempts', () => {
    expect(githubV1WakeSweepTask).toMatchObject({
      id: 'github-v1-wake-sweep',
      cron: '*/1 * * * *',
      retry: { maxAttempts: 3 },
    })
  })
})
