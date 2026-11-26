import { describe, expect, it } from 'bun:test'

import { EAgentStart } from '../../agents/start'
import { EDecision, EOperatorInputOutcome, EWorktreeExit } from '../../events/body'
import { toCallId } from '../../events/ids'
import { ERunFailureKind } from '../../events/run-failure'
import { EShellStatus } from '../../shells/status'
import { chainEvents } from '../chain-events'
import type { RecordEvent, RecordEventBody } from '../event'
import { ERetention, EVENT_RETENTION, RETAINED_TYPES, retainedOf, retentionOf } from '../retention'
import { ETurnCause, ETurnEndedBy, ETurnOutcome } from '../turns'
import { NOW, runId, threadId } from './support'

const log = (bodies: RecordEventBody[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const seqsOf = (args: { events: readonly RecordEvent[]; before: number }): number[] =>
  retainedOf(args).map((event) => event.seq)

const turnPair = (turnId: string): RecordEventBody[] => [
  { type: 'turn-started', turnId, cause: ETurnCause.Input },
  { type: 'turn-ended', turnId, outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent },
]

const call = (callId: string): RecordEventBody[] => [
  { type: 'tool-called', callId: toCallId(callId), name: 'bash', ordinal: 0 },
  { type: 'tool-result', callId: toCallId(callId), name: 'bash' },
]

const runFailed: RecordEventBody = {
  type: 'run-failed',
  failure: { kind: ERunFailureKind.Auth, message: 'signed out' },
}

describe('retentionOf', () => {
  it('classes the core types', () => {
    expect(retentionOf('turn-started')).toBe(ERetention.Open)
    expect(retentionOf('agent-spawned')).toBe(ERetention.All)
    expect(retentionOf('context-changed')).toBe(ERetention.Latest)
    expect(retentionOf('user-said')).toBe(ERetention.None)
  })

  it('keeps every unknown and plugin type', () => {
    expect(retentionOf('skills-changed')).toBe(ERetention.All)
  })

  it('lists the types a tail keeps', () => {
    expect(RETAINED_TYPES).toContain('turn-started')
    expect(RETAINED_TYPES).not.toContain('user-said')
    expect(RETAINED_TYPES).toContain('history-rewound')
  })

  it('classifies every core type', () => {
    expect(Object.keys(EVENT_RETENTION).length).toBeGreaterThan(60)
  })
})

describe('retainedOf', () => {
  it('keeps everything at or after the boundary', () => {
    const events = log([
      {
        type: 'agent-spawned',
        agentId: threadId,
        agentType: 'explore',
        intent: 'look',
        mode: EAgentStart.Fresh,
      },
      { type: 'background-shell-started', shellId: 's1', command: 'bun dev' },
    ])
    expect(seqsOf({ events, before: 1 })).toEqual([1, 2])
    expect(retainedOf({ events: log([{ type: 'user-said', text: 'go' }]), before: 0 })).toEqual([])
  })

  it('drops a closed turn group before the boundary', () => {
    const events = log([...turnPair('a'), ...turnPair('b'), { type: 'user-said', text: 'go' }])
    expect(seqsOf({ events, before: 5 })).toEqual([3, 4])
  })

  it('keeps an open turn', () => {
    const events = log([
      ...turnPair('a'),
      { type: 'turn-started', turnId: 'b', cause: ETurnCause.Input },
      { type: 'user-said', text: 'go' },
    ])
    expect(seqsOf({ events, before: 4 })).toEqual([1, 2, 3])
  })

  it('drops a tool call together with its result', () => {
    const events = log([...call('c1'), ...call('c2'), { type: 'user-said', text: 'go' }])
    expect(seqsOf({ events, before: 5 })).toEqual([])
  })

  it('keeps a call whose result never came', () => {
    const events = log([
      { type: 'tool-called', callId: toCallId('c1'), name: 'bash', ordinal: 0 },
      { type: 'user-said', text: 'go' },
    ])
    expect(seqsOf({ events, before: 2 })).toEqual([1])
  })

  it('drops an answered approval and keeps an open one', () => {
    const events = log([
      { type: 'approval-requested', callId: toCallId('c1'), reason: 'run it' },
      { type: 'approval-answered', callId: toCallId('c1'), decision: EDecision.Allow },
      { type: 'approval-requested', callId: toCallId('c2'), reason: 'run it' },
    ])
    expect(seqsOf({ events, before: 3 })).toEqual([3])
  })

  it('keeps only the unanswered operator request', () => {
    const events = log([
      { type: 'operator-input-requested', requestId: 'r1', description: 'code', path: 'a' },
      { type: 'operator-input-requested', requestId: 'r2', description: 'code', path: 'b' },
      {
        type: 'operator-input-resolved',
        requestId: 'r1',
        outcome: EOperatorInputOutcome.Delivered,
      },
    ])
    expect(seqsOf({ events, before: 4 })).toEqual([2])
  })

  it('keeps a running shell and drops an ended one', () => {
    const events = log([
      { type: 'background-shell-started', shellId: 's1', command: 'bun dev' },
      {
        type: 'background-shell-ended',
        shellId: 's1',
        command: 'bun dev',
        status: EShellStatus.Exited,
        output: '',
        droppedCharacters: 0,
        remainingCharacters: 0,
      },
      { type: 'background-shell-started', shellId: 's2', command: 'bun dev' },
    ])
    expect(seqsOf({ events, before: 3 })).toEqual([3])
  })

  it('drops a run-failed once a message supersedes it', () => {
    const events = log([runFailed, { type: 'assistant-said', parts: [] }])
    expect(seqsOf({ events, before: 3 })).toEqual([])
  })

  it('keeps a run-failed nothing has superseded', () => {
    const events = log([runFailed, { type: 'nudge', text: 'try again', lifetimeSteps: 1 }])
    expect(seqsOf({ events, before: 3 })).toEqual([1])
  })

  it('drops a run-failed when its own dismissal follows and keeps the dismissal', () => {
    const events = log([runFailed, { type: 'run-failure-dismissed', failureSeq: 1 }])
    expect(seqsOf({ events, before: 3 })).toEqual([2])
  })

  it('keeps a refusal until a message clears it', () => {
    const kept = log([{ type: 'input-refused', inboxId: 3, reason: 'no' }])
    expect(seqsOf({ events: kept, before: 2 })).toEqual([1])
    const cleared = log([
      { type: 'input-refused', inboxId: 3, reason: 'no' },
      { type: 'user-said', text: 'go' },
    ])
    expect(seqsOf({ events: cleared, before: 3 })).toEqual([])
  })

  it('keeps the newest worktree event of each thread', () => {
    const events = log([
      { type: 'worktree-entered', path: '/one', branch: 'b' },
      { type: 'worktree-exited', path: '/one', action: EWorktreeExit.Keep },
      { type: 'worktree-entered', path: '/two', branch: 'b' },
      { type: 'user-said', text: 'go' },
    ])
    expect(seqsOf({ events, before: 4 })).toEqual([3])
  })

  it('keeps every context change that names a path no newer change names', () => {
    const events = log([
      { type: 'context-changed', paths: ['a.md', 'b.md'] },
      { type: 'context-changed', paths: ['a.md'] },
      { type: 'context-changed', paths: ['b.md', 'c.md'] },
    ])
    expect(seqsOf({ events, before: 3 })).toEqual([2, 3])
  })

  it('keeps agent events whatever their age', () => {
    const events = log([
      {
        type: 'agent-spawned',
        agentId: threadId,
        agentType: 'explore',
        intent: 'look',
        mode: EAgentStart.Fresh,
      },
      { type: 'user-said', text: 'go' },
    ])
    expect(seqsOf({ events, before: 2 })).toEqual([1])
  })

  it('is idempotent', () => {
    const events = log([
      ...turnPair('a'),
      ...call('c1'),
      { type: 'background-shell-started', shellId: 's1', command: 'bun dev' },
      { type: 'context-changed', paths: ['a.md'] },
      {
        type: 'agent-spawned',
        agentId: threadId,
        agentType: 'explore',
        intent: 'look',
        mode: EAgentStart.Fresh,
      },
      { type: 'user-said', text: 'go' },
    ])
    const once = retainedOf({ events, before: 9 })
    expect(retainedOf({ events: once, before: 9 })).toEqual(once)
  })

  it('dedupes by seq', () => {
    const events = log([
      {
        type: 'agent-spawned',
        agentId: threadId,
        agentType: 'explore',
        intent: 'look',
        mode: EAgentStart.Fresh,
      },
    ])
    expect(retainedOf({ events: [...events, ...events], before: 2 })).toHaveLength(1)
  })
})
