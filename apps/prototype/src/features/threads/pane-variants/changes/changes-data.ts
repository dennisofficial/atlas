import { type ChangedFile, EFileChange, totalChanges } from '@dltech/atlas-ui/ai/changes-panel'

import { DIFFS } from './changes-diffs'

export interface ChangeEntry extends ChangedFile {
  from?: string
}

interface Row {
  path: string
  change: EFileChange
  added: number
  removed: number
  from?: string
}

const ROWS: Row[] = [
  {
    path: 'apps/prototype/src/features/threads/pod-panels.tsx',
    change: EFileChange.Modified,
    added: 7,
    removed: 7,
  },
  {
    path: 'apps/web/src/app/layout.tsx',
    change: EFileChange.Modified,
    added: 6,
    removed: 2,
  },
  {
    path: 'apps/web/src/components/right-pane/changes-tab.tsx',
    change: EFileChange.Added,
    added: 142,
    removed: 0,
  },
  {
    path: 'apps/web/src/components/right-pane/index.ts',
    change: EFileChange.Modified,
    added: 3,
    removed: 1,
  },
  {
    path: 'deprecated/ui/changes-panel.tsx',
    change: EFileChange.Deleted,
    added: 0,
    removed: 418,
  },
  {
    path: 'docs/architecture.md',
    change: EFileChange.Modified,
    added: 14,
    removed: 6,
  },
  {
    path: 'packages/core/src/session/__tests__/geometry.spec.ts',
    change: EFileChange.Added,
    added: 74,
    removed: 0,
  },
  {
    path: 'packages/core/src/session/geometry.ts',
    change: EFileChange.Modified,
    added: 37,
    removed: 15,
  },
  {
    path: 'packages/ui/src/ai/changes-panel.tsx',
    change: EFileChange.Modified,
    added: 44,
    removed: 18,
  },
  {
    path: 'packages/ui/src/ai/file-tree.tsx',
    change: EFileChange.Modified,
    added: 31,
    removed: 12,
  },
  {
    path: 'packages/ui/src/ai/internal/__tests__/changes-tree.spec.tsx',
    change: EFileChange.Added,
    added: 96,
    removed: 0,
  },
  {
    path: 'packages/ui/src/ai/internal/changes-row.tsx',
    change: EFileChange.Modified,
    added: 26,
    removed: 9,
    from: 'packages/ui/src/ai/internal/changes-file-row.tsx',
  },
  {
    path: 'packages/ui/src/ai/internal/changes-tree.ts',
    change: EFileChange.Modified,
    added: 58,
    removed: 24,
  },
  {
    path: 'packages/ui/src/components/button.tsx',
    change: EFileChange.Modified,
    added: 12,
    removed: 3,
  },
  {
    path: 'packages/ui/src/styles/theme.css',
    change: EFileChange.Modified,
    added: 2063,
    removed: 1,
  },
  {
    path: 'packages/ui/src/styles/theme.generated.css',
    change: EFileChange.Added,
    added: 4120,
    removed: 0,
  },
  {
    path: 'packages/ui/src/tokens/semantic.ts',
    change: EFileChange.Modified,
    added: 9,
    removed: 4,
  },
]

export const CHANGES: ChangeEntry[] = ROWS.map((row) => ({ ...row, ...DIFFS[row.path] }))

export const CHANGE_TOTALS = totalChanges(CHANGES)
