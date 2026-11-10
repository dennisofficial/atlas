import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { RoutineRunRow } from '@dltech/atlas-protocol'

import { RoutineRunList } from '../routine-run-list'

const run = (outcome: RoutineRunRow['outcome'], reason: string | null = null): RoutineRunRow => ({
  runId: `run-${outcome}`,
  scheduledFor: '2026-11-10T07:00:00.000Z',
  outcome,
  reason,
  sessionId: null,
  at: '2026-11-10T07:00:02.000Z',
})

const render = (runs: readonly RoutineRunRow[]) =>
  renderToStaticMarkup(<RoutineRunList runs={runs} timeZone="UTC" />)

describe('RoutineRunList', () => {
  it('names every outcome the dispatcher records', () => {
    const html = render([run('started'), run('skipped-busy'), run('skipped'), run('failed')])
    expect(html).toContain('started')
    expect(html).toContain('skipped, busy')
    expect(html).toContain('skipped')
    expect(html).toContain('failed')
  })

  it('marks a blown-up run as a failure with its reason', () => {
    const html = render([run('failed', 'sandbox boot timed out')])
    expect(html).toContain('text-destructive')
    expect(html).toContain('sandbox boot timed out')
  })

  it('says so when no run has happened yet', () => {
    expect(render([])).toContain('No runs yet.')
  })
})
