import type { EContextFileKind } from '@dltech/atlas-core'

export type ContextFileRow = {
  path: string
  digest: string | null
  size: number
  mime: string
  kind: EContextFileKind
  mtimeMs: number
  updatedAt: number
}

export type ContextFileWrite = Omit<ContextFileRow, 'updatedAt'>
