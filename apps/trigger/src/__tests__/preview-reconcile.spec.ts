import { describe, expect, it, mock } from 'bun:test'
import type { PreviewOrphanSummary, PreviewPassSummary } from '@dltech/atlas-previews'
import { triggerSdkFake } from './trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { previewReconcileTask } = await import('../trigger/previews/preview-reconcile.task')
const { PREVIEW_SWEEP_GRACE_MS, readPreviewSweepDryRun, runPreviewReconcile } = await import(
  '../trigger/previews/preview-reconcile'
)

const emptyPass: PreviewPassSummary = {
  checked: 0,
  synced: 0,
  deleted: 0,
  skipped: 0,
  failed: 0,
  failures: [],
}

const emptySweep: PreviewOrphanSummary = { dryRun: false, tunnels: [], dnsRecords: [] }

describe('the preview-reconcile task', () => {
  it('runs every five minutes with three attempts', () => {
    expect(previewReconcileTask).toMatchObject({
      id: 'preview-reconcile',
      cron: { pattern: '*/5 * * * *', window: '0m' },
      retry: { maxAttempts: 3 },
    })
  })
})

describe('runPreviewReconcile', () => {
  it('reconciles the pods it is given and sweeps with the grace', async () => {
    const passes: unknown[] = []
    const sweeps: unknown[] = []
    const lines: string[] = []

    const run = await runPreviewReconcile({
      deps: {
        pass: async (args) => {
          passes.push(args)
          return emptyPass
        },
        sweep: async (args) => {
          sweeps.push(args)
          return emptySweep
        },
      },
      log: (line) => lines.push(line),
      sweepDryRun: true,
      podSessionIds: ['pod-a', 'pod-b'],
    })

    const log = passes[0] as { log: (line: string) => void; podSessionIds: string[] }
    expect(log.podSessionIds).toEqual(['pod-a', 'pod-b'])
    expect(typeof log.log).toBe('function')
    expect(sweeps).toEqual([{ graceMs: PREVIEW_SWEEP_GRACE_MS, dryRun: true }])
    expect(run.sweepDryRun).toBe(true)
    expect(lines.at(-1)).toBe('preview sweep (dry run): 0 tunnels, 0 dns records')
  })

  it('lets the pass choose the pods when none are given', async () => {
    const passes: unknown[] = []

    await runPreviewReconcile({
      deps: {
        pass: async (args) => {
          passes.push(args)
          return emptyPass
        },
        sweep: async () => emptySweep,
      },
      log: () => undefined,
      sweepDryRun: false,
    })

    const pass = passes[0] as Record<string, unknown>
    expect(pass['podSessionIds']).toBeUndefined()
    expect(pass['limit']).toBeUndefined()
  })

  it('sweeps live by default and only a forced environment makes it a dry run', async () => {
    expect(readPreviewSweepDryRun({})).toBe(false)
    expect(readPreviewSweepDryRun({ PREVIEW_SWEEP_DRY_RUN: 'false' })).toBe(false)
    expect(readPreviewSweepDryRun({ PREVIEW_SWEEP_DRY_RUN: 'true' })).toBe(true)
    expect(readPreviewSweepDryRun({ PREVIEW_SWEEP_DRY_RUN: '1' })).toBe(true)
  })
})
