import { describe, expect, it } from 'vitest'

import { EAgentRestart, EAgentStatus, type ThreadId } from '@dltech/atlas-core'

import { AgentNoticeQueue, EAgentNotice, type AgentNotice } from '../notices'
import type { AgentSnapshot } from '../snapshot'

const PARENT = 'brn_parent' as ThreadId
const CHILD = 'brn_child' as ThreadId

const snapshot = (): AgentSnapshot => ({
  agentId: CHILD,
  agentType: 'explore',
  intent: 'looking',
  status: EAgentStatus.Finished,
  spawnedBy: PARENT,
  turns: 1,
  toolCalls: 0,
  lastTool: undefined,
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:01:00.000Z',
})

const restartNotice = (): AgentNotice => ({
  threadId: PARENT,
  snapshot: snapshot(),
  kind: EAgentNotice.Ending,
  logged: true,
  draft: {
    type: 'agent-restarted',
    agentId: CHILD,
    agentType: 'explore',
    intent: 'looking',
    via: EAgentRestart.Wake,
  },
})

const endingNotice = (): AgentNotice => ({
  threadId: PARENT,
  snapshot: snapshot(),
  kind: EAgentNotice.Ending,
  logged: false,
  draft: {
    type: 'agent-ended',
    agentId: CHILD,
    agentType: 'explore',
    intent: 'looking',
    status: EAgentStatus.Finished,
    prose: 'done',
    turns: 1,
    toolCalls: 0,
  },
})

describe('a notice queue holding only bookkeeping', () => {
  it('does not list the thread as awaiting input', () => {
    const queue = new AgentNoticeQueue()
    queue.queue(restartNotice())

    expect(queue.threadsAwaiting()).toEqual([])
  })

  it('still lists the thread when a real ending is queued', () => {
    const queue = new AgentNoticeQueue()
    queue.queue(endingNotice())

    expect(queue.threadsAwaiting()).toEqual([PARENT])
  })

  it('marks a prepared batch of bookkeeping as not waking the turn', () => {
    const queue = new AgentNoticeQueue()
    queue.queue(restartNotice())

    const batch = queue.prepare({ threadId: PARENT })

    expect(batch.wakesTurn).toBe(false)
  })

  it('marks a prepared batch carrying a real ending as waking the turn', () => {
    const queue = new AgentNoticeQueue()
    queue.queue(endingNotice())

    const batch = queue.prepare({ threadId: PARENT })

    expect(batch.wakesTurn).toBe(true)
  })
})
