import type { ChangeContentStore } from './change-content'
import type { ChangeBlobRow } from './port'

export const CHANGES_GC_GRACE_MS = 7 * 24 * 60 * 60 * 1_000

export const CHANGES_GC_ROW_LIMIT = 500

const PRESENT_BATCH_SIZE = 1_000

export type ChangesGcStore = {
  changeBlobsUnreferenced(params: {
    olderThanMs: number
    limit: number
  }): Promise<readonly ChangeBlobRow[]>
  deleteChangeBlobs(params: { hashes: readonly string[] }): Promise<void>
  changeBlobsPresent(params: { hashes: readonly string[] }): Promise<ReadonlySet<string>>
}

export type ChangesGcContent = Pick<ChangeContentStore, 'list' | 'removing'>

export type ChangesGcParams = {
  store: ChangesGcStore
  content: ChangesGcContent
  graceMs?: number | undefined
}

export type ChangesGcSummary = {
  rowsDeleted: number
  objectsDeleted: number
  failures: number
}

type GcRun = {
  store: ChangesGcStore
  content: ChangesGcContent
  graceMs: number
  cutoff: number
  summary: ChangesGcSummary
  attempted: Set<string>
}

const deleted = async (work: () => Promise<void>): Promise<boolean> => {
  try {
    await work()
    return true
  } catch {
    return false
  }
}

const deleteUnreferencedRows = async (run: GcRun): Promise<void> => {
  for (;;) {
    const rows = await run.store.changeBlobsUnreferenced({
      olderThanMs: run.graceMs,
      limit: CHANGES_GC_ROW_LIMIT,
    })
    if (rows.length === 0) return
    const hashes = rows.map((row) => row.hash)
    for (const hash of hashes) run.attempted.add(hash)
    if (!(await deleted(() => run.store.deleteChangeBlobs({ hashes })))) {
      run.summary.failures += 1
      return
    }
    run.summary.rowsDeleted += hashes.length
    if (await deleted(() => run.content.removing(hashes))) {
      run.summary.objectsDeleted += hashes.length
      continue
    }
    run.summary.failures += 1
  }
}

const deleteOrphanObjects = async (run: GcRun): Promise<void> => {
  const objects = await run.content.list()
  const candidates = objects.filter(
    (object) =>
      object.createdAt > 0 && object.createdAt < run.cutoff && !run.attempted.has(object.hash),
  )
  for (let start = 0; start < candidates.length; start += PRESENT_BATCH_SIZE) {
    const batch = candidates.slice(start, start + PRESENT_BATCH_SIZE)
    const present = await run.store.changeBlobsPresent({
      hashes: batch.map((object) => object.hash),
    })
    const hashes = batch.map((object) => object.hash).filter((hash) => !present.has(hash))
    if (hashes.length === 0) continue
    if (await deleted(() => run.content.removing(hashes))) {
      run.summary.objectsDeleted += hashes.length
      continue
    }
    run.summary.failures += 1
  }
}

export const runChangesGc = async (params: ChangesGcParams): Promise<ChangesGcSummary> => {
  const graceMs = params.graceMs ?? CHANGES_GC_GRACE_MS
  const run: GcRun = {
    store: params.store,
    content: params.content,
    graceMs,
    cutoff: Date.now() - graceMs,
    summary: { rowsDeleted: 0, objectsDeleted: 0, failures: 0 },
    attempted: new Set(),
  }
  await deleteUnreferencedRows(run)
  await deleteOrphanObjects(run)
  return run.summary
}
