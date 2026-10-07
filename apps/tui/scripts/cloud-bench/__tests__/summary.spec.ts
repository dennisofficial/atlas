import { expect, it } from 'bun:test'
import { summarizeSamples } from '../summary'

it('reports timings but marks a rebaked image as unsuitable for controlled comparisons', () => {
  const runtime = { version: null, protocol: '19', bakeId: 'first' }
  const summary = summarizeSamples([
    { liftMs: 1000, descendMs: 4000, workspaceCommit: 'same', runtime },
    {
      liftMs: 2000,
      descendMs: 3000,
      workspaceCommit: 'same',
      runtime: { ...runtime, bakeId: 'second' },
    },
  ])
  expect(summary.lift.medianMs).toBe(1500)
  expect(summary.comparable).toBe(false)
  expect(summary.runtimeDrift).toBe(true)
  expect(summary.workspaceDrift).toBe(false)
})
