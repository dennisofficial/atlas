import type {
  PreviewOrphanSummary,
  PreviewPassSummary,
  PreviewReconciler,
} from '@dltech/atlas-previews'

export const PREVIEW_SWEEP_GRACE_MS = 30 * 60_000

export type PreviewReconcileRun = {
  pass: PreviewPassSummary
  sweep: PreviewOrphanSummary
  sweepDryRun: boolean
}

export type PreviewReconcileDeps = Pick<PreviewReconciler, 'pass' | 'sweep'>

export async function runPreviewReconcile(args: {
  deps: PreviewReconcileDeps
  log: (line: string) => void
  sweepDryRun: boolean
  podSessionIds?: readonly string[]
}): Promise<PreviewReconcileRun> {
  const pass = await args.deps.pass({
    log: args.log,
    ...(args.podSessionIds === undefined ? {} : { podSessionIds: args.podSessionIds }),
  })
  const sweep = await args.deps.sweep({ graceMs: PREVIEW_SWEEP_GRACE_MS, dryRun: args.sweepDryRun })
  args.log(
    `preview sweep (${args.sweepDryRun ? 'dry run' : 'live'}): ${sweep.tunnels.length} tunnels, ${sweep.dnsRecords.length} dns records`,
  )
  return { pass, sweep, sweepDryRun: args.sweepDryRun }
}

export const readPreviewSweepDryRun = (
  env: Record<string, string | undefined> = process.env,
): boolean => {
  const raw = env['PREVIEW_SWEEP_DRY_RUN']
  return raw === '1' || raw === 'true'
}
