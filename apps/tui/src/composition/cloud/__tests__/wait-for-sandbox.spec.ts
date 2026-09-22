import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { ECloudSandboxState, type CloudSandboxStatus } from '../cloud-bridge'
import { waitForSandbox } from '../wait-for-sandbox'

const THREAD_ID = toThreadId('polling-thread')

const clock = (args: { intervalMs: number } = { intervalMs: 2000 }) => {
  let elapsed = 0
  const sleeps: number[] = []
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      elapsed += ms
    },
    sleeps,
    intervalMs: args.intervalMs,
  }
}

describe('waiting for a sandbox to come up', () => {
  it('returns at once when the first poll already carries a url', async () => {
    const time = clock()
    const finds: number[] = []
    const found = await waitForSandbox({
      sandboxes: {
        create: async () => {
          throw new Error('unused')
        },
        putContext: async () => {
          throw new Error('unused')
        },
        find: async () => {
          finds.push(1)
          return { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' }
        },
        destroy: async () => undefined,
      },
      threadId: THREAD_ID,
      sleep: time.sleep,
      now: time.now,
    })

    expect(found).toEqual({ url: 'https://sandbox.example/thread', contextPending: undefined })
    expect(finds).toHaveLength(1)
    expect(time.sleeps).toEqual([])
  })

  it('carries contextPending through from the status that answered', async () => {
    const time = clock()

    const found = await waitForSandbox({
      sandboxes: {
        create: async () => {
          throw new Error('unused')
        },
        putContext: async () => {
          throw new Error('unused')
        },
        find: async () => ({
          state: ECloudSandboxState.Running,
          url: 'https://sandbox.example/thread',
          contextPending: false,
        }),
        destroy: async () => undefined,
      },
      threadId: THREAD_ID,
      sleep: time.sleep,
      now: time.now,
    })

    expect(found).toEqual({ url: 'https://sandbox.example/thread', contextPending: false })
  })

  it('keeps polling while the sandbox is still resuming, then returns the url once running', async () => {
    const time = clock()
    const statuses: CloudSandboxStatus[] = [
      { state: ECloudSandboxState.Resuming },
      { state: ECloudSandboxState.Resuming },
      { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' },
    ]

    const found = await waitForSandbox({
      sandboxes: {
        create: async () => {
          throw new Error('unused')
        },
        putContext: async () => {
          throw new Error('unused')
        },
        find: async () => statuses.shift(),
        destroy: async () => undefined,
      },
      threadId: THREAD_ID,
      intervalMs: 2000,
      sleep: time.sleep,
      now: time.now,
    })

    expect(found).toEqual({ url: 'https://sandbox.example/thread', contextPending: undefined })
    expect(time.sleeps).toEqual([2000, 2000])
  })

  it('treats a running status with no url yet as not ready', async () => {
    const time = clock()
    const statuses: CloudSandboxStatus[] = [
      { state: ECloudSandboxState.Running },
      { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' },
    ]

    const found = await waitForSandbox({
      sandboxes: {
        create: async () => {
          throw new Error('unused')
        },
        putContext: async () => {
          throw new Error('unused')
        },
        find: async () => statuses.shift(),
        destroy: async () => undefined,
      },
      threadId: THREAD_ID,
      sleep: time.sleep,
      now: time.now,
    })

    expect(found).toEqual({ url: 'https://sandbox.example/thread', contextPending: undefined })
  })

  it('throws when the control plane has never heard of the sandbox', async () => {
    const time = clock()

    await expect(
      waitForSandbox({
        sandboxes: {
          create: async () => {
            throw new Error('unused')
          },
          putContext: async () => {
            throw new Error('unused')
          },
          find: async () => undefined,
          destroy: async () => undefined,
        },
        threadId: THREAD_ID,
        sleep: time.sleep,
        now: time.now,
      }),
    ).rejects.toThrow(/failed to start/)
  })

  it('times out when the sandbox never comes up', async () => {
    const time = clock()

    await expect(
      waitForSandbox({
        sandboxes: {
          create: async () => {
            throw new Error('unused')
          },
          putContext: async () => {
            throw new Error('unused')
          },
          find: async () => ({ state: ECloudSandboxState.Resuming }),
          destroy: async () => undefined,
        },
        threadId: THREAD_ID,
        timeoutMs: 5000,
        intervalMs: 2000,
        sleep: time.sleep,
        now: time.now,
      }),
    ).rejects.toThrow(/timed out/)
  })

  it('polls through thrown status answers and returns once one succeeds', async () => {
    const time = clock()
    let polls = 0

    const found = await waitForSandbox({
      sandboxes: {
        create: async () => {
          throw new Error('unused')
        },
        putContext: async () => undefined,
        find: async () => {
          polls += 1
          if (polls <= 2) throw new Error('502 Bad Gateway')
          return { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' }
        },
        destroy: async () => undefined,
      },
      threadId: THREAD_ID,
      sleep: time.sleep,
      now: time.now,
    })

    expect(found).toEqual({ url: 'https://sandbox.example/thread', contextPending: undefined })
    expect(time.sleeps).toEqual([2000, 2000])
  })

  it('fails the wait with the last error once the error budget is spent', async () => {
    const time = clock()

    await expect(
      waitForSandbox({
        sandboxes: {
          create: async () => {
            throw new Error('unused')
          },
          putContext: async () => undefined,
          find: async () => {
            throw new Error('provision blew up')
          },
          destroy: async () => undefined,
        },
        threadId: THREAD_ID,
        errorBudgetMs: 5000,
        intervalMs: 2000,
        sleep: time.sleep,
        now: time.now,
      }),
    ).rejects.toThrow(/failed to start: provision blew up/)
  })

  it('resets the error budget after a status answer succeeds', async () => {
    const time = clock()
    const answers: Array<CloudSandboxStatus | Error> = [
      new Error('stale failure'),
      { state: ECloudSandboxState.Resuming },
      new Error('fresh failure'),
      { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' },
    ]

    const found = await waitForSandbox({
      sandboxes: {
        create: async () => {
          throw new Error('unused')
        },
        putContext: async () => undefined,
        find: async () => {
          const answer = answers.shift()
          if (answer instanceof Error) throw answer
          return answer
        },
        destroy: async () => undefined,
      },
      threadId: THREAD_ID,
      errorBudgetMs: 1000,
      intervalMs: 2000,
      sleep: time.sleep,
      now: time.now,
    })

    expect(found).toEqual({ url: 'https://sandbox.example/thread', contextPending: undefined })
  })
})
