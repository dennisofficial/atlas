import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy } from '@dltech/atlas-core'

import { closeRegistries, ELSEWHERE, job, openRegistry, THREAD } from './shell-registry-fixture'

afterEach(closeRegistries)

describe('awaiting the endings a kill caused', () => {
  it('leaves the ending queued by the time it resolves', async () => {
    const { registry } = openRegistry()
    const started = registry.start(job({ command: 'sleep 30' }))
    if (!started.ok) throw new Error(started.reason)

    registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.ContainerSwitch,
      threadId: THREAD,
    })
    const stillDying = await registry.awaitEndings({ threadId: THREAD, ms: 5_000 })

    expect(stillDying).toBe(0)
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
    expect(registry.drainNotifications({ threadId: THREAD })[0]?.type).toBe(
      'background-shell-ended',
    )
  })

  it('counts a shell that ignores the signal and leaves its ending to announce later', async () => {
    const { registry } = openRegistry()
    const started = registry.start(job({ command: "trap '' TERM; exec sleep 30" }))
    if (!started.ok) throw new Error(started.reason)
    await Bun.sleep(300)

    registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.ContainerSwitch,
      threadId: THREAD,
    })
    const stillDying = await registry.awaitEndings({ threadId: THREAD, ms: 100 })

    expect(stillDying).toBe(1)
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(0)
  }, 15_000)

  it('never waits on shells another thread owns', async () => {
    const { registry } = openRegistry()
    const started = registry.start(job({ command: 'sleep 30', threadId: ELSEWHERE }))
    if (!started.ok) throw new Error(started.reason)

    registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.ContainerSwitch,
      threadId: ELSEWHERE,
    })

    expect(await registry.awaitEndings({ threadId: THREAD, ms: 100 })).toBe(0)
    expect(await registry.awaitEndings({ threadId: ELSEWHERE, ms: 5_000 })).toBe(0)
  })
})
