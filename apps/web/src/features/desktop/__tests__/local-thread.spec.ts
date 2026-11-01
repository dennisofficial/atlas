import { describe, expect, it, spyOn } from 'bun:test'

import { wireThreadSchema } from '@dltech/atlas-wire/web'

import { EThreadStatus, isUnread, isWorking, threadStatusOf } from '@/features/shell/thread-status'

import { ELocalPodState, localPodSchema } from '../desktop-wire'
import { localThreadOf, podStatusOf, withLocalPods } from '../local-thread'

const hostPod = (state: ELocalPodState) =>
  localPodSchema.parse({
    threadId: 'brn_mac',
    projectId: 'project_mac',
    title: 'Local work',
    model: 'anthropic/claude-sonnet-4-6',
    effort: 'high',
    createdAt: '2026-10-29T10:00:00.000Z',
    state,
  })

describe('Mac host pod to sidebar status', () => {
  it('shows a stopped host pod as parked through the actual thread adapter', () => {
    const thread = localThreadOf(hostPod(ELocalPodState.Stopped))

    expect(threadStatusOf(thread)).toBe(EThreadStatus.Parked)
    expect(wireThreadSchema.parse(thread).status?.podState).toBe('parked')
  })

  it('keeps a running host pod idle rather than inventing an active model turn', () => {
    const thread = localThreadOf(hostPod(ELocalPodState.Running))

    expect(threadStatusOf(thread)).toBe(EThreadStatus.Idle)
    expect(wireThreadSchema.parse(thread).status).toEqual({
      working: false,
      awaiting: null,
      lastOutcome: null,
      podState: 'running',
      lastAssistantSeq: 0,
      readSeq: null,
    })
    expect(isWorking(thread)).toBe(false)
    expect(isUnread({ thread, active: false })).toBe(false)
  })

  it('shows a missing host pod as failed without inventing a failed model turn', () => {
    const pod = hostPod(ELocalPodState.Missing)
    const thread = localThreadOf(pod)

    expect(threadStatusOf(thread)).toBe(EThreadStatus.Failed)
    expect(wireThreadSchema.parse(thread).status?.podState).toBe('failed')
    expect(thread.status?.lastOutcome).toBeNull()
    expect(podStatusOf(pod).state).toBe('failed')
  })

  it.each([undefined, 'unknown'])('does not classify unknown host state %s as parked', (state) => {
    const pod = hostPod(ELocalPodState.Running)
    Reflect.set(pod, 'state', state)
    const thread = localThreadOf(pod)

    expect(threadStatusOf(thread)).toBe(EThreadStatus.Idle)
    expect(wireThreadSchema.parse(thread).status).toBeUndefined()
  })

  it('preserves host identity and statuses in the project sidebar without network calls', () => {
    const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network call'))
    try {
      const entries = withLocalPods({
        entries: [{ project: { id: 'project_mac' }, sessions: [] }],
        pods: [
          hostPod(ELocalPodState.Running),
          hostPod(ELocalPodState.Stopped),
          hostPod(ELocalPodState.Missing),
        ],
      })
      const threads = entries.flatMap((entry) =>
        entry.sessions.map((session) => session.mainThread),
      )

      expect(threads.map(threadStatusOf)).toEqual([
        EThreadStatus.Idle,
        EThreadStatus.Parked,
        EThreadStatus.Failed,
      ])
      expect(threads[0]).toMatchObject({
        id: 'brn_mac',
        projectId: 'project_mac',
        runner: 'local',
        title: 'Local work',
        model: { ref: 'anthropic/claude-sonnet-4-6', effort: 'high' },
      })
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
})
