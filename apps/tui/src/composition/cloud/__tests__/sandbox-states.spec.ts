import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { ECloudSandboxState, type CloudSandboxes } from '../cloud-bridge'
import { sandboxStatesFor } from '../sandbox-states'

const finder = (args: {
  states: Readonly<Record<string, ECloudSandboxState>>
  failing?: readonly string[]
}): Pick<CloudSandboxes, 'find'> => ({
  find: async ({ threadId }) => {
    if (args.failing?.includes(threadId as string) === true) throw new Error('vercel is down')
    const state = args.states[threadId as string]
    return state === undefined ? undefined : { state }
  },
})

describe('reading sandbox states for the picker', () => {
  it('answers every asked thread with its state', async () => {
    const states = await sandboxStatesFor({
      find: finder({
        states: { 'thread-a': ECloudSandboxState.Running, 'thread-b': ECloudSandboxState.Parked },
      }),
      threadIds: ['thread-a', 'thread-b'],
    })

    expect(states.get('thread-a')).toBe(ECloudSandboxState.Running)
    expect(states.get('thread-b')).toBe(ECloudSandboxState.Parked)
    expect(states.size).toBe(2)
  })

  it('leaves out a thread the control plane has never heard of', async () => {
    const states = await sandboxStatesFor({
      find: finder({ states: {} }),
      threadIds: ['thread-a'],
    })

    expect(states.size).toBe(0)
  })

  it('leaves out a thread whose read fails rather than failing the batch', async () => {
    const states = await sandboxStatesFor({
      find: finder({
        states: { 'thread-a': ECloudSandboxState.Resuming },
        failing: ['thread-b'],
      }),
      threadIds: ['thread-a', 'thread-b'],
    })

    expect(states.get('thread-a')).toBe(ECloudSandboxState.Resuming)
    expect(states.has('thread-b')).toBe(false)
  })

  it('asks by thread id, as the sandbox name derives from it', async () => {
    const asked: string[] = []
    const states = await sandboxStatesFor({
      find: {
        find: async ({ threadId }) => {
          asked.push(threadId as string)
          return { state: ECloudSandboxState.Running }
        },
      },
      threadIds: ['thread-a'],
    })

    expect(asked).toEqual([toThreadId('thread-a') as string])
    expect(states.size).toBe(1)
  })
})
