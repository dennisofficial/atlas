import { describe, expect, it, mock } from 'bun:test'
import { triggerSdkFake } from './trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { podSleepTask } = await import('../trigger/pod-power/pod-sleep.task')
const { podResizeTask } = await import('../trigger/pod-resize/pod-resize.task')
const { podDiskGrowTask } = await import('../trigger/pod-disk/pod-disk-grow.task')
const { podDiskGrowOneTask } = await import('../trigger/pod-disk/pod-disk-grow-one.task')
const { agent37UsageReconcileTask } = await import(
  '../trigger/sandbox-cost/agent37-usage-reconcile.task'
)
const { orphanPodSweepTask } = await import('../trigger/sandbox-provisioning/orphan-pod-sweep.task')

describe('the pod tasks this worker registers', () => {
  it('keeps the ids, crons and retries the api project ran', () => {
    expect(podSleepTask).toMatchObject({
      id: 'pod-sleep',
      retry: { maxAttempts: 3 },
      maxDuration: 120,
    })
    expect(podResizeTask).toMatchObject({
      id: 'pod-resize',
      retry: { maxAttempts: 3 },
      maxDuration: 120,
    })
    expect(podDiskGrowOneTask).toMatchObject({
      id: 'pod-disk-grow-one',
      retry: { maxAttempts: 2 },
      maxDuration: 120,
    })
    expect(podDiskGrowTask).toMatchObject({
      id: 'pod-disk-grow',
      cron: { pattern: '*/5 * * * *', window: '0m' },
      retry: { maxAttempts: 1 },
    })
    expect(agent37UsageReconcileTask).toMatchObject({
      id: 'agent37-usage-reconcile',
      cron: { pattern: '5 * * * *', window: '0m' },
      retry: { maxAttempts: 3 },
    })
    expect(orphanPodSweepTask).toMatchObject({
      id: 'orphan-pod-sweep',
      cron: { pattern: '5 * * * *', window: '0m' },
      retry: { maxAttempts: 3 },
    })
  })
})
