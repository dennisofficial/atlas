import { describe, expect, it, mock } from 'bun:test'
import { triggerRecords, triggerSdkFake } from './trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { requeuePodResize } = await import('../pod-resize/pod-resize-graph')

describe('a pod task that requeues itself', () => {
  it('triggers pod-resize again with the next wait count, a global key and the delay', async () => {
    triggerRecords.length = 0

    const payload = await requeuePodResize({
      payload: { sessionId: 'ses-1', generation: 2, vcpus: 4, memoryGb: 8 },
      delaySeconds: 30,
    })

    expect(payload).toEqual({ sessionId: 'ses-1', generation: 2, vcpus: 4, memoryGb: 8, waits: 1 })
    expect(triggerRecords).toEqual([
      {
        taskId: 'pod-resize',
        payload,
        idempotencyKey: 'pod-resize:ses-1:2:1',
        delay: '30s',
      },
    ])
  })

  it('counts the wait it is on, so a retried requeue cannot dispatch twice', async () => {
    triggerRecords.length = 0

    await requeuePodResize({
      payload: { sessionId: 'ses-1', generation: 2, vcpus: 4, memoryGb: 8, waits: 3 },
      delaySeconds: 30,
    })

    expect(triggerRecords[0]?.idempotencyKey).toBe('pod-resize:ses-1:2:4')
  })

  it('refuses a payload the jobs schema rejects', async () => {
    triggerRecords.length = 0

    await expect(
      requeuePodResize({
        payload: { sessionId: '', generation: 2, vcpus: 4, memoryGb: 8 },
        delaySeconds: 30,
      }),
    ).rejects.toThrow()
    expect(triggerRecords).toEqual([])
  })
})
