export type MemoryScope = 'global' | 'project'

export type MemoryKind = 'user' | 'feedback' | 'project' | 'reference'

export type MemoryAddress = { scope: MemoryScope; name: string }

export type MemorySummary = {
  scope: MemoryScope
  project: string | null
  name: string
  description: string
  type: MemoryKind
  revision: number
  updatedAt: string
}

export type MemoryEntry = MemorySummary & { body: string }

export type MemorySnapshot = { project: string | null; memories: readonly MemorySummary[] }

export type PodMemory = {
  list(): Promise<MemorySnapshot>
  read(args: MemoryAddress): Promise<MemoryEntry | null>
  write(
    args: MemoryAddress & { description: string; type: MemoryKind; body: string },
  ): Promise<MemorySummary>
  edit(args: MemoryAddress & { old: string; new: string; revision: number }): Promise<MemorySummary>
  delete(args: MemoryAddress): Promise<boolean>
}
