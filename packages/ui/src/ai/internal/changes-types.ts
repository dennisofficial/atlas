import type { DiffLine } from '../diff-viewer'
import type { EFileChange } from '../file-tree'

export interface ChangedFile {
  path: string
  added: number
  removed: number
  change: EFileChange
  hunk?: string
  lines?: DiffLine[]
}

export interface ChangeScopeOption {
  id: string
  label: string
  detail?: string
}

export type ChangesLayout = 'flat' | 'tree'
