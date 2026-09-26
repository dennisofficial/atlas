import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EExecutionLocation, toRunId } from '@dltech/atlas-core'

import { useAtlasHome } from './descend-fixture'
import { fakeAgentSnapshot } from './fake-agents'
import { ELiftStep, liftToCloud } from '../lift'
import { CLOUD_THREAD } from './fixture'
import { CHILD, SETTLED_CHILD, fakeLiftAgents, harness } from './lift-fixture'

describe('lifting the family along with the conversation', () => {
  it('stops stepping children before tarring anything', async () => {
    useAtlasHome()
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
    expect(test.steps.indexOf(ELiftStep.Stopping)).toBeLessThan(
      test.steps.indexOf(ELiftStep.Transferring),
    )
  })

  it('flips every child, settled and stepping alike, and notes the move on each local log', async () => {
    useAtlasHome()
    const stepping = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const settled = fakeAgentSnapshot({
      agentId: 'child-done',
      spawnedBy: CLOUD_THREAD,
      status: EAgentStatus.Finished,
    })
    const agents = fakeLiftAgents([stepping, settled])
    const test = harness({ agents })
    await test.localThreads.createWithFirstEvents({
      threadId: CHILD,
      runId: toRunId('run_child'),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
      agent: { spawnedBy: CLOUD_THREAD, type: 'explore' },
    })
    await test.localThreads.createWithFirstEvents({
      threadId: SETTLED_CHILD,
      runId: toRunId('run_settled'),
      drafts: [{ type: 'user-said', text: 'already finished' }],
      agent: { spawnedBy: CLOUD_THREAD, type: 'explore' },
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(agents.relocatedTo).toEqual([EExecutionLocation.Cloud])

    for (const agentId of [CHILD, SETTLED_CHILD]) {
      const row = await test.localThreads.find({ threadId: agentId })
      expect(row?.executionLocation).toBe(EExecutionLocation.Cloud)

      const events = test.localLog.peek({ threadId: agentId })
      expect(events.some((event) => event.type === 'user-said')).toBe(true)

      const locationChanged = events.find((event) => event.type === 'location-changed')
      if (locationChanged === undefined || locationChanged.type !== 'location-changed') {
        throw new Error(`expected a location-changed event for ${agentId}`)
      }
      expect(locationChanged.from).toBe(EExecutionLocation.Host)
      expect(locationChanged.to).toBe(EExecutionLocation.Cloud)
      expect(
        test.bridge.log.peek({ threadId: agentId }).some((event) => event.type === 'location-changed'),
      ).toBe(false)
    }
  })

  it('carries nothing extra when the conversation has no children', async () => {
    useAtlasHome()
    const test = harness()

    await liftToCloud(test.args)

    expect(test.bridge.trail).toEqual(['sandbox', 'put-transcript', 'attach'])
    expect(test.bridge.transcriptPuts).toHaveLength(1)
  })
})

describe('a mid-turn lift', () => {
  it('interrupts the turn and waits for it to settle before stopping anything else', async () => {
    useAtlasHome()
    const test = harness({ midTurn: true })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.interrupts).toBe(1)
    expect(test.settleWaits).toBe(1)
    expect(test.steps.slice(0, 2)).toEqual([ELiftStep.Interrupting, ELiftStep.Stopping])
  })

  it('narrates resuming once attached and says the arrival should resume it', async () => {
    useAtlasHome()
    const test = harness({ midTurn: true })

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    expect(test.steps.at(-1)).toBe(ELiftStep.Resuming)
    expect(lifted.resumeOnArrival).toBe(true)
  })

  it('never interrupts or resumes when nothing was running', async () => {
    useAtlasHome()
    const test = harness({ midTurn: false })

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    expect(test.steps).not.toContain(ELiftStep.Interrupting)
    expect(test.steps).not.toContain(ELiftStep.Resuming)
    expect(test.interrupts).toBe(0)
    expect(lifted.resumeOnArrival).toBe(false)
  })
})
