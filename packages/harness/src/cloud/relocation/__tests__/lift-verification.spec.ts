import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'

import { fakeAgentSnapshot } from './fake-agents'
import { ELiftFault, ELiftStep, liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { CHILD, fakeLiftAgents, harness } from './lift-fixture'

describe('a transfer that lands short on the far side', () => {
  it('aborts the lift before anything flips when the cloud accepts the create but holds fewer events than were sent', async () => {
    const bridge = fakeBridge()
    const honestHead = bridge.stores.log.head
    bridge.stores.log.head = async ({ threadId }) => {
      const head = await honestHead({ threadId })
      return threadId === CLOUD_THREAD ? head - 1 : head
    }
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.fault).toBe(ELiftFault.Transfer)
    expect(lifted.step).toBe(ELiftStep.Transferring)
    expect(lifted.detail).toContain('came back short')
    expect(test.located).toEqual([])
    expect(test.bridge.attached).toEqual([])
  })

  it('aborts a re-lift when the cloud accepts the replace but reads back short', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_seed'),
      drafts: [{ type: 'user-said', text: 'stale cloud copy' }],
    })
    const honestHead = bridge.stores.log.head
    bridge.stores.log.head = async ({ threadId }) => {
      const head = await honestHead({ threadId })
      return threadId === CLOUD_THREAD ? head - 1 : head
    }
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.step).toBe(ELiftStep.Transferring)
    expect(lifted.detail).toContain('came back short')
    expect(test.located).toEqual([])
  })

  it('aborts the whole lift and resumes the stopped children when a child log lands short', async () => {
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const bridge = fakeBridge()
    const honestHead = bridge.stores.log.head
    bridge.stores.log.head = async ({ threadId }) => {
      const head = await honestHead({ threadId })
      return threadId === CHILD ? head - 1 : head
    }
    const test = harness({ agents, bridge })
    await test.localLog.append({
      threadId: CHILD,
      runId: toRunId('run_child'),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
    })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.step).toBe(ELiftStep.Transferring)
    expect(lifted.detail).toContain('came back short')
    expect(test.located).toEqual([])
    expect(agents.relocatedTo).toEqual([])
    expect(agents.resumed).toEqual([CHILD])
  })
})

describe('the title on re-lift', () => {
  it('updates the cloud title when the local title moved since the last lift', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_seed'),
      drafts: [{ type: 'user-said', text: 'stale cloud copy' }],
      title: 'the old title',
    })
    const test = harness({ bridge, title: 'the title it earned at home' })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(bridge.threads.renames).toEqual([
      { threadId: CLOUD_THREAD, title: 'the title it earned at home' },
    ])
    expect((await bridge.threads.find({ threadId: CLOUD_THREAD }))?.title).toBe(
      'the title it earned at home',
    )
  })

  it('leaves the cloud title alone when re-lifting without one', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_seed'),
      drafts: [{ type: 'user-said', text: 'stale cloud copy' }],
      title: 'the old title',
    })
    const test = harness({ bridge, title: null })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(bridge.threads.renames).toEqual([])
    expect((await bridge.threads.find({ threadId: CLOUD_THREAD }))?.title).toBe('the old title')
  })
})
