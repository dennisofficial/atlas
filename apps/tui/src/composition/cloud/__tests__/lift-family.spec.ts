import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import type { ThreadStorePort } from '@dltech/atlas-harness'

import { fakeAgentSnapshot } from '../../__tests__/fake-agents'
import { ELiftStep, liftToCloud } from '../lift'
import { CLOUD_THREAD } from './fixture'
import { CHILD, SETTLED_CHILD, fakeLiftAgents, harness } from './lift-fixture'

describe('lifting the family along with the conversation', () => {
  it('opens the parent in the cloud before any child, whose row references it', async () => {
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const test = harness({ agents: fakeLiftAgents([child]) })
    const opened: ThreadId[] = []
    const store = test.bridge.stores.threads
    const create = store.createWithFirstEvents.bind(store)
    store.createWithFirstEvents = async (
      createArgs: Parameters<ThreadStorePort['createWithFirstEvents']>[0],
    ) => {
      if (createArgs.threadId !== undefined) opened.push(createArgs.threadId)
      return create(createArgs)
    }

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(opened).toEqual([CLOUD_THREAD, CHILD])
  })

  it('stops stepping children before transferring anything', async () => {
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const test = harness({ agents })
    await test.localLog.append({
      threadId: CHILD,
      runId: toRunId('run_child'),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(agents.stopCalls).toBe(1)
  })

  it('transfers every child log, settled and stepping alike, flips them and notes the move on each', async () => {
    const stepping = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const settled = fakeAgentSnapshot({
      agentId: 'child-done',
      spawnedBy: CLOUD_THREAD,
      status: EAgentStatus.Finished,
    })
    const agents = fakeLiftAgents([stepping, settled])
    const test = harness({ agents })
    await test.localLog.append({
      threadId: CHILD,
      runId: toRunId('run_child'),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
    })
    await test.localLog.append({
      threadId: SETTLED_CHILD,
      runId: toRunId('run_settled'),
      drafts: [{ type: 'user-said', text: 'already finished' }],
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(agents.relocatedTo).toEqual([EExecutionLocation.Cloud])

    for (const agentId of [CHILD, SETTLED_CHILD]) {
      expect(await test.bridge.threads.find({ threadId: agentId })).toBeDefined()
      const events = test.bridge.log.peek({ threadId: agentId })
      expect(events.some((event) => event.type === 'user-said')).toBe(true)

      const locationChanged = events.find((event) => event.type === 'location-changed')
      if (locationChanged === undefined || locationChanged.type !== 'location-changed') {
        throw new Error(`expected a location-changed event for ${agentId}`)
      }
      expect(locationChanged.from).toBe(EExecutionLocation.Host)
      expect(locationChanged.to).toBe(EExecutionLocation.Cloud)
    }
  })

  it('carries nothing extra when the conversation has no children', async () => {
    const test = harness()

    await liftToCloud(test.args)

    expect(test.bridge.trail).toEqual(['transfer', 'sandbox', 'attach'])
  })
})

describe('a mid-turn lift', () => {
  it('interrupts the turn and waits for it to settle before stopping anything else', async () => {
    const test = harness({ midTurn: true })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.interrupts).toBe(1)
    expect(test.settleWaits).toBe(1)
    expect(test.steps.slice(0, 2)).toEqual([ELiftStep.Interrupting, ELiftStep.Stopping])
  })

  it('narrates resuming once attached and says the arrival should resume it', async () => {
    const test = harness({ midTurn: true })

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    expect(test.steps.at(-1)).toBe(ELiftStep.Resuming)
    expect(lifted.resumeOnArrival).toBe(true)
  })

  it('never interrupts or resumes when nothing was running', async () => {
    const test = harness({ midTurn: false })

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    expect(test.steps).not.toContain(ELiftStep.Interrupting)
    expect(test.steps).not.toContain(ELiftStep.Resuming)
    expect(test.interrupts).toBe(0)
    expect(lifted.resumeOnArrival).toBe(false)
  })
})
