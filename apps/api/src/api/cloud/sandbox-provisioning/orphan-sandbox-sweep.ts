export const ORPHAN_SANDBOX_GRACE_MS = 24 * 60 * 60 * 1_000
const DELETE_CONCURRENCY = 4

export type OrphanSandbox = { name: string; status: string; createdAt: number }

export type OrphanSandboxStore = {
  listSandboxes: () => Promise<readonly OrphanSandbox[]>
  deleteSandbox: (args: { name: string }) => Promise<void>
}

export type OrphanSweepSummary = {
  projects: number
  scanned: number
  deleted: number
  kept: number
  failed: number
  dryRun: boolean
}

/**
 * A stopped sandbox nothing can resume is pure storage: its name derives from the session that owned
 * it, so a sandbox whose name no live session resolves — a deleted thread, a dead v2 session, a
 * leftover from a probe — is unreachable by every code path and only its snapshot is still billed.
 */
export function orphanSandboxesToDelete(args: {
  sandboxes: readonly OrphanSandbox[]
  liveNames: ReadonlySet<string>
  now: Date
  graceMs?: number
}): OrphanSandbox[] {
  const cutoff = args.now.getTime() - (args.graceMs ?? ORPHAN_SANDBOX_GRACE_MS)
  return args.sandboxes.filter(
    (sandbox) =>
      sandbox.status !== 'running' &&
      !args.liveNames.has(sandbox.name) &&
      sandbox.createdAt < cutoff,
  )
}

async function deleteBounded(args: {
  targets: readonly OrphanSandbox[]
  deleteSandbox: (args: { name: string }) => Promise<void>
  onDeleted: () => void
  onFailed: (args: { name: string; failure: unknown }) => void
}): Promise<void> {
  const queue = [...args.targets]
  const worker = async (): Promise<void> => {
    for (let target = queue.shift(); target !== undefined; target = queue.shift()) {
      try {
        await args.deleteSandbox({ name: target.name })
        args.onDeleted()
      } catch (failure) {
        args.onFailed({ name: target.name, failure })
      }
    }
  }
  await Promise.all(Array.from({ length: DELETE_CONCURRENCY }, worker))
}

export async function sweepOrphanSandboxes(args: {
  stores: readonly { label: string; store: OrphanSandboxStore }[]
  liveNames: () => Promise<ReadonlySet<string>>
  now: Date
  dryRun: boolean
  log: (line: string) => void
  graceMs?: number
}): Promise<OrphanSweepSummary> {
  const summary: OrphanSweepSummary = {
    projects: args.stores.length,
    scanned: 0,
    deleted: 0,
    kept: 0,
    failed: 0,
    dryRun: args.dryRun,
  }
  const liveNames = await args.liveNames()
  for (const { label, store } of args.stores) {
    const sandboxes = await store.listSandboxes()
    summary.scanned += sandboxes.length
    const targets = orphanSandboxesToDelete({
      sandboxes,
      liveNames,
      now: args.now,
      ...(args.graceMs === undefined ? {} : { graceMs: args.graceMs }),
    })
    summary.kept += sandboxes.length - targets.length
    args.log(
      `${label}: ${sandboxes.length} sandboxes, ${targets.length} unreachable${args.dryRun ? ' (dry run)' : ''}`,
    )
    if (args.dryRun) continue
    await deleteBounded({
      targets,
      deleteSandbox: (deleteArgs) => store.deleteSandbox(deleteArgs),
      onDeleted: () => {
        summary.deleted += 1
      },
      onFailed: ({ name, failure }) => {
        summary.failed += 1
        args.log(`${label}: could not delete ${name}: ${String(failure)}`)
      },
    })
  }
  return summary
}
