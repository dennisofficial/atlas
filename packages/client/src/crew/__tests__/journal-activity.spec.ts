import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId, type V2Event } from '@dltech/atlas-core'

import { journalActivityOf } from '../journal-activity'

const threadId = toThreadId('thread-activity')
const childId = toThreadId('thread-child')

let sequence = 0

const at = (seq: number) => ({
  id: toEventId(`event-${seq}`),
  seq,
  epoch: 0,
  prevHash: '0'.repeat(64),
  at: '2026-01-01T00:00:00.000Z',
})

const eventOf = (body: Record<string, unknown>): V2Event => {
  sequence += 1
  return {
    ...body,
    threadId,
    runId: toRunId('run-1'),
    depth: 0,
    ...at(sequence),
  } as V2Event
}

const shellStarted = (shellId: string, bootId?: string): V2Event =>
  eventOf({
    type: 'background-shell-started',
    shellId,
    command: `run ${shellId}`,
    ...(bootId === undefined ? {} : { bootId }),
  })

const shellEnded = (shellId: string, bootId?: string): V2Event =>
  eventOf({
    type: 'background-shell-ended',
    shellId,
    command: `run ${shellId}`,
    ...(bootId === undefined ? {} : { bootId }),
    status: 'exited',
    exitCode: 0,
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
  })

const spawned = (agentId = childId): V2Event =>
  eventOf({
    type: 'agent-spawned',
    agentId,
    agentType: 'explore',
    intent: 'map',
    mode: 'background',
  })

const ended = (agentId = childId): V2Event =>
  eventOf({
    type: 'agent-ended',
    agentId,
    agentType: 'explore',
    intent: 'map',
    status: 'finished',
    prose: 'done',
    turns: 1,
    toolCalls: 2,
  })

describe('what a journal says is still running', () => {
  it('is nothing before anything starts', () => {
    expect(journalActivityOf([])).toEqual({ subagents: 0, shells: 0 })
  })

  it('counts a shell from its start until its ending', () => {
    expect(journalActivityOf([shellStarted('sh_1')])).toEqual({ subagents: 0, shells: 1 })
    expect(journalActivityOf([shellStarted('sh_1'), shellEnded('sh_1')])).toEqual({
      subagents: 0,
      shells: 0,
    })
  })

  it('keeps a shell of the same id apart across a boot', () => {
    const events = [shellStarted('sh_1', 'boot-a'), shellStarted('sh_1', 'boot-b')]
    expect(journalActivityOf(events)).toEqual({ subagents: 0, shells: 2 })
  })

  it('counts a child from its spawn until its ending, and counts it again when restarted', () => {
    expect(journalActivityOf([spawned()])).toEqual({ subagents: 1, shells: 0 })
    expect(journalActivityOf([spawned(), ended()])).toEqual({ subagents: 0, shells: 0 })
    const restarted = eventOf({
      type: 'agent-restarted',
      agentId: childId,
      agentType: 'explore',
      intent: 'map',
      via: 'resume',
    })
    expect(journalActivityOf([spawned(), ended(), restarted])).toEqual({ subagents: 1, shells: 0 })
  })

  it('counts the whole tree at once', () => {
    const events = [spawned(), shellStarted('sh_1'), shellStarted('sh_2'), shellEnded('sh_2')]
    expect(journalActivityOf(events)).toEqual({ subagents: 1, shells: 1 })
  })
})
