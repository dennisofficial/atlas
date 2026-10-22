import { describe, expect, it } from 'bun:test'

import type { Event, EventEnvelope } from '../../events/envelope'
import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { EKilledBy, EShellStatus } from '../status'
import {
  EShellLifecycleState,
  endedShellKeysOf,
  lostShellsOf,
  openShellIdsOf,
  shellsLifecycle,
} from '../lifecycle'

const threadId = toThreadId('thread-lifecycle')

let sequence = 0
const envelopeAt = (runId: string): EventEnvelope => {
  sequence += 1
  return {
    id: toEventId(`event-${sequence}`),
    seq: sequence,
    threadId,
    runId: toRunId(runId),
    depth: 0,
    at: '2026-01-01T00:00:00.000Z',
  }
}

const started = (args: {
  shellId: string
  command: string
  bootId?: string
  description?: string
}): Event =>
  ({
    type: 'background-shell-started',
    shellId: args.shellId,
    command: args.command,
    ...(args.description === undefined ? {} : { description: args.description }),
    ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
    ...envelopeAt('run-1'),
  }) as Event

const ended = (args: {
  shellId: string
  command: string
  bootId?: string
  killedBy?: EKilledBy
}): Event =>
  ({
    type: 'background-shell-ended',
    shellId: args.shellId,
    command: args.command,
    ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
    status: args.killedBy === undefined ? EShellStatus.Exited : EShellStatus.Killed,
    ...(args.killedBy === undefined ? { exitCode: 0 } : { killedBy: args.killedBy }),
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
    ...envelopeAt('run-1'),
  }) as Event

describe('shellsLifecycle', () => {
  it('marks a started-and-ended shell settled', () => {
    const events = [
      started({ shellId: 'bash_1', command: 'bun test', bootId: 'boot-1' }),
      ended({ shellId: 'bash_1', command: 'bun test', bootId: 'boot-1' }),
    ]

    const lifecycles = shellsLifecycle(events)
    expect(lifecycles).toHaveLength(1)
    expect(lifecycles[0]?.state).toBe(EShellLifecycleState.Settled)
  })

  it('marks a start with no end lost', () => {
    const events = [started({ shellId: 'bash_1', command: 'bun test', bootId: 'boot-1' })]
    expect(shellsLifecycle(events)[0]?.state).toBe(EShellLifecycleState.Lost)
  })

  it('never lets a recycled id under a new boot settle a start from an old boot', () => {
    const events = [
      started({ shellId: 'bash_1', command: 'bun test', bootId: 'boot-1' }),
      started({ shellId: 'bash_1', command: 'bun test', bootId: 'boot-2' }),
      ended({ shellId: 'bash_1', command: 'bun test', bootId: 'boot-2' }),
    ]

    const lifecycles = shellsLifecycle(events)
    expect(lifecycles).toHaveLength(2)
    expect(lifecycles[0]?.state).toBe(EShellLifecycleState.Lost)
    expect(lifecycles[0]?.bootId).toBe('boot-1')
    expect(lifecycles[1]?.state).toBe(EShellLifecycleState.Settled)
    expect(lifecycles[1]?.bootId).toBe('boot-2')
  })

  it('pairs FIFO within one boot when an id is reused inside a single process', () => {
    const events = [
      started({ shellId: 'bash_1', command: 'first', bootId: 'boot-1' }),
      started({ shellId: 'bash_1', command: 'second', bootId: 'boot-1' }),
      ended({ shellId: 'bash_1', command: 'first', bootId: 'boot-1' }),
    ]

    const lifecycles = shellsLifecycle(events)
    expect(lifecycles[0]?.state).toBe(EShellLifecycleState.Settled)
    expect(lifecycles[0]?.command).toBe('first')
    expect(lifecycles[1]?.state).toBe(EShellLifecycleState.Lost)
    expect(lifecycles[1]?.command).toBe('second')
  })

  it('falls back to id-only FIFO for events that predate bootId', () => {
    const events = [
      started({ shellId: 'bash_1', command: 'bun test' }),
      ended({ shellId: 'bash_1', command: 'bun test' }),
    ]

    expect(shellsLifecycle(events)[0]?.state).toBe(EShellLifecycleState.Settled)
  })

  it('ignores an end with no matching open start', () => {
    const events = [ended({ shellId: 'bash_9', command: 'orphan', bootId: 'boot-1' })]
    expect(shellsLifecycle(events)).toHaveLength(0)
  })
})

describe('the projections over the lifecycle', () => {
  it('lostShellsOf returns only the unsettled starts', () => {
    const events = [
      started({ shellId: 'bash_1', command: 'one', bootId: 'boot-1' }),
      started({ shellId: 'bash_2', command: 'two', bootId: 'boot-1' }),
      ended({ shellId: 'bash_1', command: 'one', bootId: 'boot-1' }),
    ]

    expect(lostShellsOf(events).map((shell) => shell.shellId)).toEqual(['bash_2'])
  })

  it('openShellIdsOf mirrors the lost set', () => {
    const events = [
      started({ shellId: 'bash_1', command: 'one', bootId: 'boot-1' }),
      started({ shellId: 'bash_2', command: 'two', bootId: 'boot-1' }),
      ended({ shellId: 'bash_1', command: 'one', bootId: 'boot-1' }),
    ]

    expect([...openShellIdsOf(events)]).toEqual(['bash_2'])
  })

  it('endedShellKeysOf names the pairing key of every recorded end', () => {
    const events = [
      started({ shellId: 'bash_1', command: 'one', bootId: 'boot-1' }),
      ended({ shellId: 'bash_1', command: 'one', bootId: 'boot-1' }),
      started({ shellId: 'bash_2', command: 'two', bootId: 'boot-1' }),
    ]

    expect([...endedShellKeysOf(events)]).toEqual(['boot-1bash_1'])
  })

  it('endedShellKeysOf counts an end whose start a compaction dropped', () => {
    const events = [ended({ shellId: 'bash_1', command: 'one', bootId: 'boot-1' })]
    expect([...endedShellKeysOf(events)]).toEqual(['boot-1bash_1'])
  })

  it('endedShellKeysOf scopes the same id under different boots to different keys', () => {
    const events = [
      ended({ shellId: 'bash_1', command: 'one', bootId: 'boot-1' }),
      ended({ shellId: 'bash_1', command: 'one', bootId: 'boot-2' }),
    ]
    expect([...endedShellKeysOf(events)].sort()).toEqual(['boot-1bash_1', 'boot-2bash_1'])
  })
})
