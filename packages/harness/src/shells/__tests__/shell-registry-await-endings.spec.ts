import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy } from '@dltech/atlas-core'

import { closeRegistries, ELSEWHERE, job, openRegistry, recorded, THREAD } from './shell-registry-fixture'

afterEach(closeRegistries)

describe('awaiting the endings a kill caused', async () => {
  it('leaves the ending in the log by the time it resolves', async () => {
    const { registry, log } = openRegistry()
    const started = await registry.start(job({ command: 'sleep 30' }))
    if (!started.ok) throw new Error(started.reason)

    registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.ContainerSwitch,
      threadId: THREAD,
    })
    const stillDying = await registry.awaitEndings({ threadId: THREAD, ms: 5_000 })

    expect(stillDying).toBe(0)
    await recorded({ log })
    expect(
      log?.appended.filter((draft) => draft.type === 'background-shell-ended'),
    ).toHaveLength(1)
  })

  it('counts a shell that ignores the signal and leaves its ending to announce later', async () => {
    const { registry } = openRegistry()
    const started = await registry.start(job({ command: "trap '' TERM; exec sleep 30" }))
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
    const started = await registry.start(job({ command: 'sleep 30', threadId: ELSEWHERE }))
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
