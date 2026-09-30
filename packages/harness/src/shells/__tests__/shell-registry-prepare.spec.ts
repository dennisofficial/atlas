import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus as ECoreShellStatus } from '@dltech/atlas-core'

import {
  announced,
  closeRegistries,
  endedDraft,
  job,
  openRegistry,
  printed,
  settle,
  THREAD,
} from './shell-registry-fixture'

afterEach(closeRegistries)

const CHECK_IN_MS = 100

describe('preparing shell notices without acknowledging', () => {
  it('prepares twice before acknowledging: a failed append loses neither notice nor output', async () => {
    const { registry } = openRegistry()
    const started = registry.start(job({ command: 'echo kept-output' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    const first = registry.prepareNotifications({ threadId: THREAD })
    const second = registry.prepareNotifications({ threadId: THREAD })

    expect(first.drafts).toHaveLength(1)
    expect(second.drafts).toHaveLength(1)
    expect(endedDraft(second.drafts[0]).output).toBe('kept-output\n')
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)

    first.acknowledge()
    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
    expect(registry.prepareNotifications({ threadId: THREAD }).drafts).toEqual([])
  })

  it('advances the cursor only to the captured point, never over output printed since', async () => {
    const { registry } = openRegistry()
    const started = registry.start(
      job({ command: `printf 'first\\n'; sleep 0.3; printf 'second\\n'` }),
    )
    if (!started.ok) throw new Error(started.reason)
    await printed({ registry, shellId: started.snapshot.shellId, text: 'first' })
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(endedDraft(batch.drafts[0]).output).toContain('first')

    batch.acknowledge()

    const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).not.toContain('first')
  })

  it('keeps a check-in queued behind a prepared batch when it replaced the captured one', async () => {
    const { registry } = openRegistry()
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
    const { registry } = openRegistry()
    const started = registry.start(job({ command: 'echo once' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    batch.acknowledge()
    batch.acknowledge()

    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
  })

  it('keeps the retained output of a prepared-but-unacknowledged ending readable', async () => {
    const { registry } = openRegistry()
    const started = registry.start(job({ command: 'echo not-yet-delivered' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(endedDraft(batch.drafts[0]).output).toBe('not-yet-delivered\n')

    expect(
      registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD }),
    ).toBe('not-yet-delivered\n')

    batch.acknowledge()
    expect(
      registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD }),
    ).toBe('')
  })

  it('enumerates a thread with a queued ending until the batch is acknowledged', async () => {
    const { registry } = openRegistry()
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

  it('drains as before: prepare plus an immediate acknowledgment', async () => {
    const { registry } = openRegistry()
    const started = registry.start(job({ command: 'echo hi' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    const drained = registry.drainNotifications({ threadId: THREAD })
    expect(drained).toHaveLength(1)
    expect(endedDraft(drained[0]).status).toBe(ECoreShellStatus.Exited)
    expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])

    const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toBe('')
  })

  it('queues nothing beside an ending shell_kill already claimed', async () => {
    const { registry } = openRegistry()
    const started = registry.start(job({ command: 'echo claimed; sleep 60' }))
    if (!started.ok) throw new Error(started.reason)
    await printed({ registry, shellId: started.snapshot.shellId, text: 'claimed' })

    const killed = registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.Model,
      threadId: THREAD,
    })
    if (!killed.ok || killed.settled === undefined) throw new Error('the kill was not claimed')
    const ending = await killed.settled
    expect(ending.died).toBe(true)
    await Bun.sleep(150)

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.drafts).toEqual([])
    batch.acknowledge()
    expect(registry.threadsWithPendingInput()).toEqual([])
  })

  it('never releases output printed after the preview, even when the shell then exits', async () => {
    const { registry } = openRegistry()
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

    const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toContain('early')

    await announced({ registry })
    const ending = registry.prepareNotifications({ threadId: THREAD })
    expect(endedDraft(ending.drafts[0]).output).toBe('')
    ending.acknowledge()
  })

  it('clears a check-in whose shell ended behind a prepared batch instead of queuing it forever', async () => {
    const { registry } = openRegistry()
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
    expect(ending.drafts.some((draft) => draft.type === 'background-shell-ended')).toBe(true)
    ending.acknowledge()
    expect(registry.threadsWithPendingInput()).toEqual([])
  })

  it('never rewinds a cursor a read advanced past the captured preview', async () => {
    const { registry } = openRegistry()
    const started = registry.start(
      job({ command: `printf 'part-one\\n'; sleep 0.3; printf 'part-two\\n'` }),
    )
    if (!started.ok) throw new Error(started.reason)
    await printed({ registry, shellId: started.snapshot.shellId, text: 'part-one' })
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(endedDraft(batch.drafts[0]).output).toContain('part-one')

    const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toContain('part-two')

    batch.acknowledge()

    const after = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(after.ok && after.delta.text).toBe('')
  })
})
