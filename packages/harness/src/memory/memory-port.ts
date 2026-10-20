import type { EMemoryScope, EMemoryType, MemoryEntry, MemorySummary } from '@dltech/atlas-wire'

export class MemoryUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryUnavailable'
  }
}

export class MemoryEditRefused extends Error {
  readonly code: string | undefined

  constructor(args: { code?: string | undefined; message: string }) {
    super(args.message)
    this.name = 'MemoryEditRefused'
    this.code = args.code
  }
}

export type MemoryAddress = { scope: EMemoryScope; name: string }

export abstract class MemoryPort {
  abstract readonly project: string | null
  abstract list(args?: { timeoutMs?: number | undefined }): Promise<readonly MemorySummary[]>
  abstract read(args: MemoryAddress): Promise<MemoryEntry | null>
  abstract write(
    args: MemoryAddress & { description: string; type: EMemoryType; body: string },
  ): Promise<MemorySummary>
  abstract edit(
    args: MemoryAddress & { old: string; new: string; revision: number },
  ): Promise<MemorySummary>
  abstract delete(args: MemoryAddress): Promise<boolean>
}
