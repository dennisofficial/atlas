import { EAgentStatus } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { foldCrew, foldParts } from '../crew-fold'

type Row = { id: string; status: EAgentStatus; agentType?: string }

const row = (id: string, status: EAgentStatus, agentType = 'explore'): Row => ({
  id,
  status,
  agentType,
})

const fold = (args: { rows: Row[]; expanded?: boolean; viewing?: string | null }) =>
  foldCrew({
    rows: args.rows,
    expanded: args.expanded ?? false,
    viewing: args.viewing ?? null,
    idOf: (one) => one.id,
  })

const idsOf = (rows: readonly Row[]): string[] => rows.map((one) => one.id)

describe('the one fold rule', () => {
  it('folds every finished, failed and stopped sub-agent, however few', () => {
    const result = fold({
      rows: [
        row('a', EAgentStatus.Finished),
        row('b', EAgentStatus.Failed),
        row('c', EAgentStatus.Stopped),
      ],
    })

    expect(idsOf(result.folded)).toEqual(['a', 'b', 'c'])
    expect(result.visible).toEqual([])
  })

  it('keeps running, blocked and paused rows visible', () => {
    const result = fold({
      rows: [
        row('a', EAgentStatus.Running),
        row('b', EAgentStatus.Blocked),
        row('c', EAgentStatus.Paused),
      ],
    })

    expect(idsOf(result.visible)).toEqual(['a', 'b', 'c'])
    expect(result.folded).toEqual([])
  })

  it('keeps the row being viewed visible even when it has settled', () => {
    const result = fold({
      rows: [row('a', EAgentStatus.Finished), row('b', EAgentStatus.Finished)],
      viewing: 'a',
    })

    expect(idsOf(result.visible)).toEqual(['a'])
    expect(idsOf(result.folded)).toEqual(['b'])
  })

  it('never folds a teammate, whatever its status', () => {
    const result = fold({
      rows: [
        row('t1', EAgentStatus.Finished, 'teammate'),
        row('t2', EAgentStatus.Failed, 'teammate'),
      ],
    })

    expect(idsOf(result.teammates)).toEqual(['t1', 't2'])
    expect(result.folded).toEqual([])
  })

  it('lists teammates before sub-agents, keeping the roster order within each', () => {
    const result = fold({
      rows: [
        row('s1', EAgentStatus.Running),
        row('t1', EAgentStatus.Running, 'teammate'),
        row('s2', EAgentStatus.Running),
      ],
    })

    expect(idsOf(result.visible)).toEqual(['t1', 's1', 's2'])
  })

  it('adds the folded rows after the visible ones when expanded', () => {
    const rows = [row('a', EAgentStatus.Finished), row('b', EAgentStatus.Running)]

    expect(idsOf(fold({ rows, expanded: true }).visible)).toEqual(['b', 'a'])
    expect(idsOf(fold({ rows }).visible)).toEqual(['b'])
  })

  it('counts done, failed and stopped separately', () => {
    const result = fold({
      rows: [
        row('a', EAgentStatus.Finished),
        row('b', EAgentStatus.Finished),
        row('c', EAgentStatus.Failed),
        row('d', EAgentStatus.Stopped),
      ],
    })

    expect([result.done, result.failed, result.stopped]).toEqual([2, 1, 1])
  })
})

describe('the words of the fold line', () => {
  it('writes every part that has a count', () => {
    expect(foldParts({ done: 11, failed: 1, stopped: 2 }).map((one) => one.label)).toEqual([
      '11 done',
      '1 failed',
      '2 stopped',
    ])
  })

  it('omits a part with a zero count', () => {
    expect(foldParts({ done: 3, failed: 0, stopped: 0 }).map((one) => one.label)).toEqual([
      '3 done',
    ])
    expect(foldParts({ done: 0, failed: 2, stopped: 0 }).map((one) => one.label)).toEqual([
      '2 failed',
    ])
  })

  it('writes nothing when nothing folded', () => {
    expect(foldParts({ done: 0, failed: 0, stopped: 0 })).toEqual([])
  })
})
