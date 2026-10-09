import { describe, expect, it } from 'bun:test'

import { ENoticeTone, type ThreadId } from '@dltech/atlas-core'

import type { RetryPolicy, SessionArchiveDescriptor } from '@dltech/atlas-wire'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { cloudArchiveOf, descend, fakeSurface, useDescendHome } from './descend-fixture'
import { RESTORED_HOME } from './workspace-fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const flakyDestroyBridge = (args: { archive: SessionArchiveDescriptor | null; failures: number }) => {
  const bridge = fakeBridge({ archive: args.archive })
  const destroy = bridge.sandboxes.destroy.bind(bridge.sandboxes)
  let failures = args.failures
  let attempts = 0
  const calls: ThreadId[] = []
  bridge.sandboxes.destroy = async (given) => {
    attempts += 1
    calls.push(given.threadId)
    if (failures > 0) {
      failures -= 1
      throw new Error('the control plane fell over')
    }
    return destroy(given)
  }
  return {
    bridge,
    get attempts() {
      return attempts
    },
    calls,
  }
}

const manualSleeper = () => {
  const pending: (() => void)[] = []
  let sleeps = 0
  return {
    sleep: async (_policy: RetryPolicy) => {
      sleeps += 1
      await new Promise<void>((resolve) => pending.push(resolve))
    },
    release: () => {
      for (const wake of pending.splice(0, pending.length)) wake()
    },
    get sleeps() {
      return sleeps
    },
  }
}

describe('descend sandbox teardown', () => {
  it('tears the sandbox down only after the workspace restore has settled', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })
    const order: string[] = []
    const destroy = bridge.sandboxes.destroy.bind(bridge.sandboxes)
    bridge.sandboxes.destroy = async (given) => {
      order.push('destroy')
      return destroy(given)
    }

    await descend({
      bridge,
      home,
      restoreWorkspace: async () => {
        order.push('restore')
        return RESTORED_HOME
      },
    })
    order.push('returned')

    expect(order.slice(0, 2)).toEqual(['restore', 'destroy'])
    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
  })

  it('fails the descend rather than destroying the sandbox when the restore throws', async () => {
    const home = useDescendHome()
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [said('one')] }]) })

    await expect(
      descend({
        bridge,
        home,
        restoreWorkspace: async () => {
          throw new Error('the restore blew up')
        },
      }),
    ).rejects.toThrow('the restore blew up')

    expect(bridge.destroyed).toEqual([])
  })

  it('retries a failed teardown after the descend resolves and replaces the warning once it lands', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([{ drafts: [said('one')] }])
    const failing = flakyDestroyBridge({ archive, failures: 1 })
    const sleeper = manualSleeper()
    const surface = fakeSurface()

    const opened = await descend({
      bridge: failing.bridge,
      home,
      surface,
      destroySleep: sleeper.sleep,
    })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(failing.attempts).toBe(1)
    const warning = surface.notices.posts.find((post) => post.key === 'descend-sandbox-destroy-failed')
    expect(warning?.tone).toBe(ENoticeTone.Warn)
    expect(warning?.text).toContain('the control plane fell over')

    sleeper.release()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(failing.attempts).toBe(2)
    expect(failing.calls).toEqual([CLOUD_THREAD, CLOUD_THREAD])
    const cleared = surface.notices.posts.filter((post) => post.key === 'descend-sandbox-destroy-failed')
    expect(cleared.at(-1)?.tone).toBe(ENoticeTone.Success)
    expect(cleared.at(-1)?.ttlMs).not.toBeNull()
  })

  it('leaves the sticky warning standing once the retry budget runs out', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([{ drafts: [said('one')] }])
    const failing = flakyDestroyBridge({ archive, failures: 3 })
    const sleeper = manualSleeper()
    const surface = fakeSurface()

    await descend({ bridge: failing.bridge, home, surface, destroySleep: sleeper.sleep })
    sleeper.release()
    await new Promise<void>((resolve) => setImmediate(resolve))
    sleeper.release()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(failing.attempts).toBe(3)
    expect(sleeper.sleeps).toBe(2)
    const posts = surface.notices.posts.filter((post) => post.key === 'descend-sandbox-destroy-failed')
    expect(posts.at(-1)?.tone).toBe(ENoticeTone.Warn)
    expect(posts.at(-1)?.ttlMs).toBeNull()
    expect(posts.at(-1)?.text).toContain('the control plane fell over')
  })
})
