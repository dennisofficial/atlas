import { EAgentStatus } from '../status'
import { describe, expect, it } from 'bun:test'

import { foldCrew } from '../crew-fold'
import { ECrewStanding } from '../crew-standing'

type Row = { id: string; status: EAgentStatus }

const row = (id: string, status: EAgentStatus = EAgentStatus.Finished): Row => ({ id, status })

const WENT_WRONG: Record<EAgentStatus, boolean> = {
  [EAgentStatus.Running]: false,
  [EAgentStatus.Blocked]: false,
  [EAgentStatus.Finished]: false,
  [EAgentStatus.Failed]: true,
  [EAgentStatus.Stopped]: true,
  [EAgentStatus.Paused]: false,
}

const wentWrong = (one: Row): boolean => WENT_WRONG[one.status]

const keyOf = (one: Row): string => one.id

const RUNNING = row('running', EAgentStatus.Running)

const HELD = row('held')

const settledRows = (count: number): readonly Row[] =>
  Array.from({ length: count }, (_, at) => row(`settled-${at}`))

const standings = (
  entries: readonly (readonly [string, ECrewStanding])[],
): ReadonlyMap<string, ECrewStanding> => new Map(entries)

const allSettled = (rows: readonly Row[]): ReadonlyMap<string, ECrewStanding> =>
  standings(rows.map((one) => [one.id, ECrewStanding.Settled] as const))

const ids = (rows: readonly Row[]): readonly string[] => rows.map(keyOf)

const fold = (args: {
  rows: readonly Row[]
  standings: ReadonlyMap<string, ECrewStanding>
  expanded?: boolean
}) =>
  foldCrew({
    rows: args.rows,
    standings: args.standings,
    expanded: args.expanded ?? false,
    keyOf,
    wentWrong,
  })

describe('crew fold', () => {
  it('shows live and held rows whatever else is settled', () => {
    const rows = [RUNNING, HELD, ...settledRows(6)]
    const folded = fold({
      rows,
      standings: standings([
        [RUNNING.id, ECrewStanding.Live],
        [HELD.id, ECrewStanding.Held],
        ...[...allSettled(settledRows(6))],
      ]),
    })

    expect(ids(folded.shown)).toEqual(['running', 'held', 'settled-4', 'settled-5'])
    expect(folded.collapsed).toHaveLength(4)
  })

  it('keeps the newest two settled rows as a tail and collapses the rest', () => {
    const rows = settledRows(5)
    const folded = fold({ rows, standings: allSettled(rows) })

    expect(ids(folded.shown)).toEqual(['settled-3', 'settled-4'])
    expect(ids(folded.collapsed)).toEqual(['settled-0', 'settled-1', 'settled-2'])
  })

  it('folds nothing when the overflow beyond the tail is a single row', () => {
    const rows = settledRows(3)
    const folded = fold({ rows, standings: allSettled(rows) })

    expect(ids(folded.shown)).toEqual(ids(rows))
    expect(folded.collapsed).toEqual([])
  })

  it('folds once the overflow beyond the tail reaches two rows', () => {
    const rows = settledRows(4)
    const folded = fold({ rows, standings: allSettled(rows) })

    expect(ids(folded.shown)).toEqual(['settled-2', 'settled-3'])
    expect(ids(folded.collapsed)).toEqual(['settled-0', 'settled-1'])
  })

  it('brings every row back when expanded, and still reports the count beyond the tail', () => {
    const rows = settledRows(5)
    const folded = fold({ rows, standings: allSettled(rows), expanded: true })

    expect(ids(folded.shown)).toEqual(ids(rows))
    expect(folded.collapsed).toHaveLength(3)
  })

  it('keeps shown rows in the order it was given', () => {
    const rows = [...settledRows(4), RUNNING]
    const folded = fold({
      rows,
      standings: standings([...[...allSettled(settledRows(4))], [RUNNING.id, ECrewStanding.Live]]),
    })

    expect(ids(folded.shown)).toEqual(['settled-2', 'settled-3', 'running'])
  })

  it('reads a row with no recorded standing as live', () => {
    const folded = fold({ rows: [RUNNING], standings: standings([]) })

    expect(folded.shown).toEqual([RUNNING])
    expect(folded.collapsed).toEqual([])
  })

  it('says when a collapsed row failed', () => {
    const rows = [row('failed', EAgentStatus.Failed), ...settledRows(3)]
    const folded = fold({ rows, standings: allSettled(rows) })

    expect(ids(folded.collapsed)).toEqual(['failed', 'settled-0'])
    expect(folded.collapsedFailed).toBe(true)
  })

  it('says when a collapsed row was stopped', () => {
    const rows = [row('stopped', EAgentStatus.Stopped), ...settledRows(3)]
    const folded = fold({ rows, standings: allSettled(rows) })

    expect(folded.collapsedFailed).toBe(true)
  })

  it('stays quiet when the collapsed rows all finished', () => {
    const rows = settledRows(5)
    const folded = fold({ rows, standings: allSettled(rows) })

    expect(folded.collapsed).toHaveLength(3)
    expect(folded.collapsedFailed).toBe(false)
  })

  it('does not call out a failure that sits in the visible tail', () => {
    const rows = [...settledRows(3), row('failed-tail', EAgentStatus.Failed)]
    const folded = fold({ rows, standings: allSettled(rows) })

    expect(ids(folded.shown)).toContain('failed-tail')
    expect(folded.collapsedFailed).toBe(false)
  })
})
