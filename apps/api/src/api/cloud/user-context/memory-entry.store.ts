export const USER_MEMORY_ENTRY_STORE = Symbol('USER_MEMORY_ENTRY_STORE')

export type NewMemoryEntry = {
  key: string
  content: Buffer
  mtimeMs: number
}

export type StoredMemoryEntry = {
  key: string
  content: Buffer
  mtimeMs: bigint
}

/**
 * Per-key memory sync on `UserMemoryEntry` — the table replacing the wholesale
 * `UserContextSync.memoryArchive` blob. PUT merges by key with last-writer-wins on mtime, so
 * an uploader never deletes keys it does not carry.
 */
export interface UserMemoryEntryStore {
  listEntries(args: { userId: string }): Promise<readonly StoredMemoryEntry[]>
  mergeEntries(args: { userId: string; entries: readonly NewMemoryEntry[] }): Promise<void>
  deleteEntries(args: { userId: string }): Promise<void>
}
