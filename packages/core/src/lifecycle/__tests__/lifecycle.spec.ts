import { describe, expect, it } from 'bun:test'

import type { Event, EventEnvelope } from '../../events/envelope'
import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { EShellStatus, type EventOfType } from '../../index'
import {
  ELifecycleState,
  endedKeysOf,
  lifecycleOf,
  lostOf,
  type LifecycleKind,
} from '../lifecycle'

const threadId = toThreadId('thread-lifecycle')

type StartedShell = EventOfType<'background-shell-started'>
type EndedShell = EventOfType<'background-shell-ended'>

let sequence = 0
const envelope = (): EventEnvelope => {
  sequence += 1
  return {
    id: toEventId(`event-${sequence}`),
    seq: sequence,
    threadId,
    runId: toRunId('run-1'),
    depth: 0,
    at: '2026-01-01T00:00:00.000Z',
  }
}

const started = (args: { shellId: string; bootId?: string }): StartedShell =>
  ({
    type: 'background-shell-started',
    shellId: args.shellId,
    command: 'bun test',
    ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
    ...envelope(),
  }) as StartedShell

const ended = (args: { shellId: string; bootId?: string }): EndedShell =>
  ({
    type: 'background-shell-ended',
    shellId: args.shellId,
    command: 'bun test',
    ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
    status: EShellStatus.Exited,
    exitCode: 0,
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
    ...envelope(),
  }) as EndedShell

const shellKind: LifecycleKind<StartedShell, EndedShell> = {
  isStart: (event): event is StartedShell => event.type === 'background-shell-started',
  isEnd: (event): event is EndedShell => event.type === 'background-shell-ended',
  keyOf: (event) => event.shellId,
  scopeOf: (event) => event.bootId ?? '',
}

describe('lifecycleOf', () => {
  it('marks an opened-and-closed thing settled', () => {
    const lifecycles = lifecycleOf(
      [started({ shellId: 'bash_1', bootId: 'b1' }), ended({ shellId: 'bash_1', bootId: 'b1' })],
      shellKind,
    )
    expect(lifecycles).toHaveLength(1)
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Settled)
  })

  it('marks an open with no close lost', () => {
    const lifecycles = lifecycleOf([started({ shellId: 'bash_1', bootId: 'b1' })], shellKind)
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Lost)
  })

  it('never lets a recycled id under a new scope settle a start from an old scope', () => {
    const lifecycles = lifecycleOf(
      [
        started({ shellId: 'bash_1', bootId: 'b1' }),
        started({ shellId: 'bash_1', bootId: 'b2' }),
        ended({ shellId: 'bash_1', bootId: 'b2' }),
      ],
      shellKind,
    )
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Lost)
    expect(lifecycles[1]?.state).toBe(ELifecycleState.Settled)
  })

  it('pairs FIFO within one scope when an id is reused', () => {
    const lifecycles = lifecycleOf(
      [
        started({ shellId: 'bash_1', bootId: 'b1' }),
        started({ shellId: 'bash_1', bootId: 'b1' }),
        ended({ shellId: 'bash_1', bootId: 'b1' }),
      ],
      shellKind,
    )
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Settled)
    expect(lifecycles[1]?.state).toBe(ELifecycleState.Lost)
  })

  it('ignores a close with no matching open', () => {
    expect(lifecycleOf([ended({ shellId: 'bash_9', bootId: 'b1' })], shellKind)).toHaveLength(0)
  })
})

describe('the projections', () => {
  it('lostOf returns only the unsettled opens', () => {
    const events: Event[] = [
      started({ shellId: 'bash_1', bootId: 'b1' }),
      started({ shellId: 'bash_2', bootId: 'b1' }),
      ended({ shellId: 'bash_1', bootId: 'b1' }),
    ]
    expect(lostOf(events, shellKind).map((lifecycle) => lifecycle.key)).toEqual(['bash_2'])
  })

  it('endedKeysOf names the scoped key of every recorded close', () => {
    const events: Event[] = [
      started({ shellId: 'bash_1', bootId: 'b1' }),
      ended({ shellId: 'bash_1', bootId: 'b1' }),
      ended({ shellId: 'bash_1', bootId: 'b2' }),
    ]
    expect([...endedKeysOf(events, shellKind)].sort()).toEqual(['b1bash_1', 'b2bash_1'])
  })
})
