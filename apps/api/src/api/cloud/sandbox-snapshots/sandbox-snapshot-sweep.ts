import type { SandboxSnapshotStore, SnapshotSummary } from './sandbox-snapshot-store'

/** A snapshot is written mid-stop before it becomes a sandbox's current one; the grace keeps that window safe. */
export const SNAPSHOT_GRACE_MS = 24 * 60 * 60 * 1000
const DELETE_CONCURRENCY = 8

export type SandboxSnapshotSweepResult = {
  retentionApplied: number
  retentionFailed: number
  deleted: number
  deleteFailed: number
  bytesFreed: number
}

async function runBounded<T>(args: {
  items: T[]
  concurrency: number
  task: (item: T) => Promise<void>
}): Promise<void> {
  const queue = [...args.items]
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await args.task(item)
  }
  await Promise.all(Array.from({ length: args.concurrency }, worker))
}

export async function sweepSandboxSnapshots(args: {
  store: SandboxSnapshotStore
  now: () => Date
  dryRun: boolean
}): Promise<SandboxSnapshotSweepResult> {
  const { store, dryRun } = args
  const result: SandboxSnapshotSweepResult = {
    retentionApplied: 0,
    retentionFailed: 0,
    deleted: 0,
    deleteFailed: 0,
    bytesFreed: 0,
  }
  const sandboxes = await store.listSandboxes()

  const unretained = sandboxes.filter((sandbox) => !sandbox.hasRetention)
  await runBounded({
    items: unretained,
    concurrency: DELETE_CONCURRENCY,
    task: async (sandbox) => {
      try {
        if (!dryRun) await store.applyRetention({ name: sandbox.name })
        result.retentionApplied++
      } catch {
        result.retentionFailed++
      }
    },
  })

  const current = new Set(sandboxes.flatMap((sandbox) => sandbox.currentSnapshotId ?? []))
  const cutoff = args.now().getTime() - SNAPSHOT_GRACE_MS
  const isDeletable = (snapshot: SnapshotSummary): boolean =>
    snapshot.status === 'created' &&
    !current.has(snapshot.id) &&
    snapshot.createdAt.getTime() < cutoff
  const doomed = (await store.listSnapshots()).filter(isDeletable)
  await runBounded({
    items: doomed,
    concurrency: DELETE_CONCURRENCY,
    task: async (snapshot) => {
      try {
        if (!dryRun) await store.deleteSnapshot({ id: snapshot.id })
        result.deleted++
        result.bytesFreed += snapshot.sizeBytes
      } catch {
        result.deleteFailed++
      }
    },
  })
  return result
}
