import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy } from '@dltech/atlas-core'

import {
  announced,
  closeRegistries,
  job,
  openRegistry,
  printed,
  settle,
  THREAD,
} from './shell-registry-fixture'

const openLogless = (args: Parameters<typeof openRegistry>[0] = {}) =>
  openRegistry({ ...args, log: null })

afterEach(closeRegistries)

const CHECK_IN_MS = 100

describe('the shell notice queue as a wake-up bell', () => {
  it('rings for an ending but yields no ending draft: the occurrence write is the record', async () => {
    const { registry } = openLogless()
    const started = registry.start(job({ command: 'echo kept-output' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.drafts).toEqual([])
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)

    batch.acknowledge()
    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
    expect(registry.prepareNotifications({ threadId: THREAD }).drafts).toEqual([])
  })

  it('captures the shell output at occurrence, so the first read after the bell serves it once', async () => {
    const { registry } = openLogless()
    const started = registry.start(
      job({ command: `printf 'first\\n'; sleep 0.3; printf 'second\\n'` }),
    )
    if (!started.ok) throw new Error(started.reason)
    await printed({ registry, shellId: started.snapshot.shellId, text: 'first' })
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    // The capture happened at occurrence: the buffer is released (peek sees nothing), and the
    // first read hands over the captured output exactly once — a second read finds it consumed.
    expect(
      registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD }),
    ).toBe('')
    const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toContain('first')
    expect(read.ok && read.delta.text).toContain('second')
    const second = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(second.ok && second.delta.text).toBe('')
  })

  it('keeps a check-in queued behind a prepared batch when it replaced the captured one', async () => {
    const { registry } = openLogless()
    const started = registry.start({ ...job({ command: 'sleep 30' }), checkInMs: CHECK_IN_MS })
    if (!started.ok) throw new Error(started.reason)

    await announced({ registry })
    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.drafts).toHaveLength(1)

    await Bun.sleep(CHECK_IN_MS * 2 + 100)
    batch.acknowledge()

    const remaining = registry.prepareNotifications({ threadId: THREAD })
    expect(remaining.drafts).toHaveLength(1)
    expect(remaining.drafts[0]?.type).toBe('background-shell-still-running')
    remaining.acknowledge()
  })

  it('acknowledges exactly once: a second ack removes nothing more', async () => {
    const { registry } = openLogless()
    const started = registry.start(job({ command: 'echo once' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    batch.acknowledge()
    batch.acknowledge()

    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
  })

  it('enumerates a thread with a queued ending until the bell is acknowledged', async () => {
    const { registry } = openLogless()
    const started = registry.start(job({ command: 'echo hi' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    expect(registry.threadsWithPendingInput()).toEqual([THREAD])

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(registry.threadsWithPendingInput()).toEqual([THREAD])

    batch.acknowledge()
    expect(registry.threadsWithPendingInput()).toEqual([])
  })

  it('drains as before: prepare plus an immediate acknowledgment, yielding no ending draft', async () => {
    const { registry } = openLogless()
    const started = registry.start(job({ command: 'echo hi' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])

    // The bell carries no draft, but the captured output still answers the first read.
    const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toBe('hi\n')
  })

  it('rings the bell for a model kill, whose settled continuation is the read of the occurrence take', async () => {
    const { registry } = openLogless()
    const started = registry.start(job({ command: 'echo claimed; sleep 60' }))
    if (!started.ok) throw new Error(started.reason)
    await printed({ registry, shellId: started.snapshot.shellId, text: 'claimed' })

    const killed = registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.Model,
      threadId: THREAD,
    })
    if (!killed.ok || killed.settled === undefined) {
      throw new Error('a model kill hands back the settled continuation')
    }
    const ending = await killed.settled
    expect(ending.died).toBe(true)
    if (ending.died) expect(ending.delta.text).toContain('claimed')

    await announced({ registry })
    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.drafts).toEqual([])
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
    batch.acknowledge()
  })

  it('never releases output printed after a live announcement, even when the shell then exits', async () => {
    const { registry } = openLogless()
    const started = registry.start({
      ...job({ command: `printf 'early\\n'; sleep 60` }),
      checkInMs: CHECK_IN_MS,
    })
    if (!started.ok) throw new Error(started.reason)
    await printed({ registry, shellId: started.snapshot.shellId, text: 'early' })

    await announced({ registry })
    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.drafts[0]?.type).toBe('background-shell-still-running')

    registry.kill({ shellId: started.snapshot.shellId, by: EKilledBy.User, threadId: THREAD })
    await settle({ registry, shellId: started.snapshot.shellId })

    batch.acknowledge()

    await announced({ registry })
    const ending = registry.prepareNotifications({ threadId: THREAD })
    expect(ending.drafts).toEqual([])
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
    ending.acknowledge()
  })

  it('clears a check-in whose shell ended behind a prepared batch instead of queuing it forever', async () => {
    const { registry } = openLogless()
    const started = registry.start({ ...job({ command: 'sleep 30' }), checkInMs: CHECK_IN_MS })
    if (!started.ok) throw new Error(started.reason)
    await announced({ registry })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.drafts).toHaveLength(1)

    registry.kill({ shellId: started.snapshot.shellId, by: EKilledBy.User, threadId: THREAD })
    await settle({ registry, shellId: started.snapshot.shellId })

    batch.acknowledge()

    const remaining = registry.prepareNotifications({ threadId: THREAD })
    expect(remaining.drafts.some((draft) => draft.type === 'background-shell-still-running')).toBe(
      false,
    )
    remaining.acknowledge()

    await announced({ registry })
    const ending = registry.prepareNotifications({ threadId: THREAD })
    expect(ending.drafts).toEqual([])
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
    ending.acknowledge()
    expect(registry.threadsWithPendingInput()).toEqual([])
  })
})
