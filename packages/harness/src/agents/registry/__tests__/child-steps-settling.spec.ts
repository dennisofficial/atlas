import { afterEach, describe, expect, it } from 'bun:test'

import { ETurnStatus } from '../../../loop/turn-outcome'
import { fakeRunners, finished, openSupervisor, type OpenedSupervisor } from './fixtures'

let opened: OpenedSupervisor | undefined

afterEach(async () => {
  await opened?.close()
  opened = undefined
})

const spawnHeld = async (supervisor: OpenedSupervisor): Promise<void> => {
  const spawned = await supervisor.supervisor.spawn({
    threadId: supervisor.parent,
    agentType: 'explore',
    brief: 'hold the step open',
    intent: 'settling probe',
  })
  if (!spawned.ok) throw new Error(spawned.reason)
}

describe('a child step still settling', () => {
  it('reports settling while the step runs and after it ends until its cleanup lands', async () => {
    opened = await openSupervisor()
    const { supervisor, runners } = opened
    expect(supervisor.settling?.()).toBe(false)

    await spawnHeld(opened)
    expect(supervisor.settling?.()).toBe(true)

    const run = runners.started[0]
    if (run === undefined) throw new Error('the child never started')
    run.settle({ ...finished(), status: ETurnStatus.Completed })

    let cleanedUp = false
    void supervisor.whenChildrenSettled({ threadId: opened.parent }).then(() => { cleanedUp = true })
    for (let attempt = 0; attempt < 400 && !cleanedUp; attempt += 1) await Bun.sleep(5)
    expect(cleanedUp).toBe(true)
    expect(supervisor.settling?.()).toBe(false)
  })

  it('announces once the last in-flight step finishes, not while any still runs', async () => {
    opened = await openSupervisor()
    const { supervisor, runners } = opened
    const settledCalls: number[] = []
    const unsubscribe = supervisor.onSettled?.(() => settledCalls.push(settledCalls.length))
    if (unsubscribe === undefined) throw new Error('onSettled is optional but must exist here')

    await spawnHeld(opened)
    await spawnHeld(opened)
    expect(runners.started).toHaveLength(2)

    runners.started[0]?.settle(finished())
    await Bun.sleep(20)
    expect(settledCalls).toHaveLength(0)

    runners.started[1]?.settle(finished())
    await Bun.sleep(20)
    expect(settledCalls).toHaveLength(1)
    unsubscribe()
  })
})
