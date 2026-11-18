import type {
  ChangeBlobRow,
  ChangeBlobWrite,
  ChangedFileWrite,
  WorktreeChangesRead,
  WorktreeChangesWrite,
} from '../../port'
import type { State } from './memory-state'

export type ChangeBlobState = { size: number; createdAt: number }

export const insertChangeBlobs = (
  blobs: Map<string, ChangeBlobState>,
  rows: readonly ChangeBlobWrite[],
  at: number,
): void => {
  for (const row of rows) {
    if (blobs.has(row.hash)) continue
    blobs.set(row.hash, { size: row.size, createdAt: at })
  }
}

export const upsertChangesIn = (params: {
  state: State
  write: WorktreeChangesWrite
  blobs: readonly ChangeBlobWrite[]
  at: number
}): void => {
  insertChangeBlobs(params.state.changeBlobs, params.blobs, params.at)
  params.state.worktreeChanges.set(params.write.checkoutId, {
    ...params.write,
    files: params.write.files.map((file) => ({ ...file })),
  })
}

const readOf = (write: WorktreeChangesWrite): WorktreeChangesRead => ({
  ...write,
  files: [...write.files].sort((a, b) => a.path.localeCompare(b.path)).map((file) => ({ ...file })),
})

export const readChangesIn = (params: { state: State; sessionId: string }): WorktreeChangesRead[] =>
  [...params.state.worktreeChanges.values()]
    .filter((write) => write.sessionId === params.sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(readOf)

export const readChangeFileIn = (params: {
  state: State
  sessionId: string
  checkoutId: string
  path: string
}): ChangedFileWrite | undefined => {
  const write = params.state.worktreeChanges.get(params.checkoutId)
  if (write === undefined || write.sessionId !== params.sessionId) return undefined
  const file = write.files.find((row) => row.path === params.path)
  return file === undefined ? undefined : { ...file }
}

export const changesUpdatedAtIn = (params: { state: State; sessionId: string }): number | null => {
  const times = [...params.state.worktreeChanges.values()]
    .filter((write) => write.sessionId === params.sessionId)
    .map((write) => write.updatedAt)
  return times.length === 0 ? null : Math.max(...times)
}

export const changeBlobsUnreferencedIn = (params: {
  state: State
  olderThanMs: number
  limit: number
  now: number
}): readonly ChangeBlobRow[] => {
  const referenced = new Set<string>()
  for (const write of params.state.worktreeChanges.values()) {
    for (const file of write.files) {
      if (file.baseHash !== null) referenced.add(file.baseHash)
      if (file.currentHash !== null) referenced.add(file.currentHash)
    }
  }
  return [...params.state.changeBlobs.entries()]
    .filter(
      ([hash, blob]) => !referenced.has(hash) && blob.createdAt < params.now - params.olderThanMs,
    )
    .sort(([, a], [, b]) => a.createdAt - b.createdAt)
    .slice(0, params.limit)
    .map(([hash, blob]) => ({ hash, size: blob.size, createdAt: blob.createdAt }))
}

export const deleteChangeBlobRowsIn = (params: {
  state: State
  hashes: readonly string[]
}): void => {
  for (const hash of params.hashes) params.state.changeBlobs.delete(hash)
}
