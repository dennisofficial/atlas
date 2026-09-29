import { describe, expect, it } from 'bun:test'

import { ELifecycleState, lifecycleOf } from '../../lifecycle/lifecycle'
import type { Event } from '../../events/envelope'
import type { EventDraft } from '../../events/body'
import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { EAgentStart } from '../start'
import { EAgentStatus } from '../status'
import { agentLifecycleKind } from '../roster'

const PARENT = toThreadId('thread_parent')
const CHILD = toThreadId('thread_child')

let seq = 0

const rowOf = (draft: EventDraft): Event => {
  seq += 1
  return {
    ...draft,
    id: toEventId(`event_${seq}`),
    seq,
    threadId: PARENT,
    runId: toRunId(`run_${seq}`),
    depth: 0,
    at: `2026-08-31T00:00:0${seq}.000Z`,
  }
}

const spawned = (agentId = CHILD): EventDraft => ({
  type: 'agent-spawned',
  agentId,
  agentType: 'explore',
  intent: 'find the callers',
  mode: EAgentStart.Fresh,
})

const ended = (agentId = CHILD): EventDraft => ({
  type: 'agent-ended',
  agentId,
  agentType: 'explore',
  intent: 'find the callers',
  status: EAgentStatus.Finished,
  prose: 'four callers',
  turns: 3,
  toolCalls: 7,
})

describe('the agent lifecycle pairing over the generic module', () => {
  it('settles a spawn once its ending lands', () => {
    const lifecycles = lifecycleOf([rowOf(spawned()), rowOf(ended())], agentLifecycleKind)

    expect(lifecycles).toHaveLength(1)
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Settled)
    expect(lifecycles[0]?.ending?.agentId).toBe(CHILD)
  })

  it('reads a spawn with no ending as lost', () => {
    const lifecycles = lifecycleOf(
      [rowOf(spawned()), rowOf({ type: 'user-said', text: 'still going?' })],
      agentLifecycleKind,
    )

    expect(lifecycles).toHaveLength(1)
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Lost)
    expect(lifecycles[0]?.ending).toBeUndefined()
  })

  it('never lets one child\'s ending settle another child\'s spawn', () => {
    const other = toThreadId('thread_other')
    const lifecycles = lifecycleOf([rowOf(spawned()), rowOf(ended(other))], agentLifecycleKind)

    expect(lifecycles).toHaveLength(1)
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Lost)
  })

  it('ignores an ending whose spawn never landed, instead of inventing a lifecycle', () => {
    const lifecycles = lifecycleOf([rowOf(ended())], agentLifecycleKind)

    expect(lifecycles).toEqual([])
  })
})
