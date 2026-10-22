import type { ChangedFile, ChangeScopeOption } from '@dltech/atlas-ui/ai/changes-panel'
import { EFileChange } from '@dltech/atlas-ui/ai/file-tree'

import { DIFF_LINES } from '../fixtures/agent'

export const CHANGED_FILES: ChangedFile[] = [
  {
    path: 'packages/ui/src/ai/changes-panel.tsx',
    added: 241,
    removed: 0,
    change: EFileChange.Added,
    lines: DIFF_LINES,
    hunk: '@@ -0,0 +1,241 @@',
  },
  {
    path: 'packages/ui/src/ai/task-dock.tsx',
    added: 198,
    removed: 0,
    change: EFileChange.Added,
    lines: DIFF_LINES,
    hunk: '@@ -0,0 +1,198 @@',
  },
  {
    path: 'apps/storybook/src/views/app/session/transcript-panel.tsx',
    added: 1240,
    removed: 3,
    change: EFileChange.Modified,
    lines: DIFF_LINES,
    hunk: '@@ -12,7 +12,9 @@',
  },
  {
    path: 'packages/ui/src/styles/theme.css',
    added: 12,
    removed: 2,
    change: EFileChange.Modified,
    lines: DIFF_LINES,
    hunk: '@@ -12,7 +12,9 @@',
  },
  {
    path: 'apps/storybook/src/views/agent-session.stories.tsx',
    added: 0,
    removed: 214,
    change: EFileChange.Deleted,
    lines: DIFF_LINES,
    hunk: '@@ -1,214 +0,0 @@',
  },
  {
    path: 'apps/storybook/src/fixtures/app.ts',
    added: 509,
    removed: 1,
    change: EFileChange.Added,
  },
]

export const CHANGE_SCOPES: ChangeScopeOption[] = [
  { id: 'all', label: 'All changes', detail: '4 commits ahead of origin/main' },
  { id: 'uncommitted', label: 'Uncommitted', detail: '3 files' },
  { id: 'c1', label: 'feat(ui): add task dock', detail: 'a1b2c3d' },
  { id: 'c2', label: 'feat(ui): add changes panel', detail: 'e4f5a6b' },
]
