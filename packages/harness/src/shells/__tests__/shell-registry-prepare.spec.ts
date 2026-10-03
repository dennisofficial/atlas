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

describe('the shell notice queue as a wake-up bell', async () => {
  it('rings for an ending but yields no ending draft: the occurrence write is the record', async () => {
    const { registry } = openLogless()
    const started = await registry.start(job({ command: 'echo kept-output' }))
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

  it('keeps the read cursor unchanged by an ending bell and its acknowledgment', async () => {
    const { registry } = openLogless()
    const started = await registry.start(
      job({ command: `printf 'first\\n'; sleep 0.3; printf 'second\\n'` }),
    )
    if (!started.ok) throw new Error(started.reason)
    await printed({ registry, shellId: started.snapshot.shellId, text: 'first' })
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    registry.prepareNotifications({ threadId: THREAD }).acknowledge()
    expect(
      await registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD }),
    ).toBe('first\nsecond\n')
    const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toContain('first')
    expect(read.ok && read.delta.text).toContain('second')
    const second = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(second.ok && second.delta.text).toBe('')
  })

  it('acknowledges exactly once: a second ack removes nothing more', async () => {
    const { registry } = openLogless()
    const started = await registry.start(job({ command: 'echo once' }))
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
    const started = await registry.start(job({ command: 'echo hi' }))
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
    const started = await registry.start(job({ command: 'echo hi' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])

    const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toBe('hi\n')
  })

  it('rings the bell for a model kill whose continuation consumes an explicit read', async () => {
    const { registry } = openLogless()
    const started = await registry.start(job({ command: 'echo claimed; sleep 60' }))
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

  it('leaves matched output readable through acknowledgment and a later ending', async () => {
    const { registry } = openLogless()
    const started = await registry.start({
      ...job({ command: `printf 'early\\n'; sleep 60` }),
      watch: 'early',
    })
    if (!started.ok) throw new Error(started.reason)
    await printed({ registry, shellId: started.snapshot.shellId, text: 'early' })

    await announced({ registry })
    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.drafts).toEqual([])
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)

    registry.kill({ shellId: started.snapshot.shellId, by: EKilledBy.User, threadId: THREAD })
    await settle({ registry, shellId: started.snapshot.shellId })

    batch.acknowledge()

    await announced({ registry })
    const ending = registry.prepareNotifications({ threadId: THREAD })
    expect(ending.drafts).toEqual([])
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
    ending.acknowledge()
    const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toBe('early\n')
    const second = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(second.ok && second.delta.text).toBe('')
    if (started.snapshot.outputPath === undefined) throw new Error('the shell must name its spool')
    expect(await Bun.file(started.snapshot.outputPath).text()).toBe('early\n')
  })
})
