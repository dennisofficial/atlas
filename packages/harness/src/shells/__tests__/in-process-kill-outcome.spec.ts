import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy } from '@dltech/atlas-core'

import { EShellStatus } from '../background-shell'
import { closeRegistries, job, openRegistry, settle, THREAD } from './shell-registry-fixture'

afterEach(closeRegistries)

describe('the in-process shell registry behind the awaited kill', () => {
  it('still answers a kill synchronously, with the killed snapshot in hand', async () => {
    const { registry } = openRegistry()
    const started = await registry.start(job({ command: 'sleep 60' }))
    if (!started.ok) throw new Error(started.reason)

    const killed = registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.User,
      threadId: THREAD,
    })

    expect(killed).not.toBeInstanceOf(Promise)
    expect(killed.ok && killed.snapshot.shellId).toBe(started.snapshot.shellId)
    await settle({ registry, shellId: started.snapshot.shellId })
  })

  it('stops a thread’s shells through stopOwners exactly as before: killed, by whom it was asked', async () => {
    const { registry } = openRegistry()
    const started = await registry.start(job({ command: 'sleep 60' }))
    if (!started.ok) throw new Error(started.reason)

    const stopped = await registry.stopOwners({
      threadIds: [THREAD],
      by: EKilledBy.ContainerSwitch,
      ms: 5_000,
    })

    expect(stopped.map((one) => one.shellId)).toEqual([started.snapshot.shellId])
    const after = registry.list({ threadId: THREAD })[0]
    expect(after?.status).toBe(EShellStatus.Killed)
    expect(after?.killedBy).toBe(EKilledBy.ContainerSwitch)
  }, 15_000)
})
