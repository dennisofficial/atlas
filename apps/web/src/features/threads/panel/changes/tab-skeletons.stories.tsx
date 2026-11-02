import { ChangesPanel, EFileChange, type ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'
import { FileTree, type FileNode } from '@dltech/atlas-ui/ai/file-tree'

import { ChangesLoading, FilesLoading } from './tab-skeletons'

const FILES: ChangedFile[] = [
  {
    path: 'src/app/page.tsx',
    added: 24,
    removed: 3,
    change: EFileChange.Modified,
  },
  {
    path: 'src/lib/session.ts',
    added: 58,
    removed: 0,
    change: EFileChange.Added,
  },
  {
    path: 'src/components/header.tsx',
    added: 2,
    removed: 14,
    change: EFileChange.Modified,
  },
  {
    path: 'src/legacy/old-menu.tsx',
    added: 0,
    removed: 91,
    change: EFileChange.Deleted,
  },
  { path: 'README.md', added: 6, removed: 1, change: EFileChange.Modified },
  {
    path: 'src/lib/format.ts',
    added: 12,
    removed: 2,
    change: EFileChange.Modified,
  },
  {
    path: 'src/lib/dates.ts',
    added: 31,
    removed: 0,
    change: EFileChange.Added,
  },
  { path: 'package.json', added: 1, removed: 1, change: EFileChange.Modified },
]

const SCOPES = [{ id: 'all', label: 'All changes' }]

const TREE: FileNode[] = [
  {
    path: 'src',
    name: 'src',
    children: [{ path: 'src/app', name: 'app', children: [] }],
  },
  {
    path: 'docs',
    name: 'docs',
    children: [{ path: 'docs/a.md', name: 'a.md' }],
  },
  {
    path: 'public',
    name: 'public',
    children: [{ path: 'public/x.svg', name: 'x.svg' }],
  },
  {
    path: 'scripts',
    name: 'scripts',
    children: [{ path: 'scripts/b.ts', name: 'b.ts' }],
  },
  { path: 'package.json', name: 'package.json' },
  { path: 'README.md', name: 'README.md' },
  { path: 'tsconfig.json', name: 'tsconfig.json' },
]

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="h-[560px] w-[420px] border bg-card">{children}</div>
}

const meta = {
  title: 'Threads/Panel/Tab skeletons',
  parameters: { layout: 'fullscreen' },
}

export default meta

export const ChangesLoadingState = {
  render: () => (
    <Frame>
      <ChangesLoading />
    </Frame>
  ),
}

export const ChangesLoaded = {
  render: () => (
    <Frame>
      <ChangesPanel files={FILES} scopes={SCOPES} scope="all" />
    </Frame>
  ),
}

export const FilesLoadingState = {
  render: () => (
    <Frame>
      <FilesLoading />
    </Frame>
  ),
}

export const FilesLoaded = {
  render: () => (
    <Frame>
      <div className="h-full overflow-auto p-2">
        <FileTree nodes={TREE} defaultOpen={false} />
      </div>
    </Frame>
  ),
}
