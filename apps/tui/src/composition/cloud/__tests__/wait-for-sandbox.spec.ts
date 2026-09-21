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
      },
      threadId: THREAD_ID,
      sleep: time.sleep,
      now: time.now,
    })

    expect(found).toEqual({ url: 'https://sandbox.example/thread' })
    expect(finds).toHaveLength(1)
    expect(time.sleeps).toEqual([])
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
      },
      threadId: THREAD_ID,
      intervalMs: 2000,
      sleep: time.sleep,
      now: time.now,
    })

    expect(found).toEqual({ url: 'https://sandbox.example/thread' })
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
      },
      threadId: THREAD_ID,
      sleep: time.sleep,
      now: time.now,
    })

    expect(found).toEqual({ url: 'https://sandbox.example/thread' })
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
        },
        threadId: THREAD_ID,
        timeoutMs: 5000,
        intervalMs: 2000,
        sleep: time.sleep,
        now: time.now,
      }),
    ).rejects.toThrow(/timed out/)
  })
})
