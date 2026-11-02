import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { FileTree, type FileNode } from './file-tree'

import { CHANGED_FILES } from '../fixtures/agent'

const meta = {
  title: 'AI/File Tree',
  component: FileTree,
  args: { nodes: CHANGED_FILES },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileTree>

export default meta

type Story = StoryObj<typeof meta>

export const Open: Story = {}

export const Collapsed: Story = { args: { defaultOpen: false } }

function SelectableTree() {
  const [selected, setSelected] = useState('packages/ui/src/ai/tool.tsx')
  return (
    <div className="flex flex-col gap-3">
      <FileTree nodes={CHANGED_FILES} selected={selected} onSelect={setSelected} />
      <p className="truncate font-mono text-xs text-muted-foreground">{selected}</p>
    </div>
  )
}

export const Selectable: Story = { render: () => <SelectableTree /> }

const DEEP: FileNode[] = [
  {
    path: 'apps',
    name: 'apps',
    children: [
      {
        path: 'apps/web',
        name: 'web',
        children: [
          { path: 'apps/web/src', name: 'src', children: [], loaded: false },
          { path: 'apps/web/package.json', name: 'package.json' },
        ],
      },
    ],
  },
]

function LazyTree() {
  const [open, setOpen] = useState<string[]>(['apps'])
  const handleOpenChange = (change: { path: string; open: boolean }) =>
    setOpen((previous) =>
      change.open ? [...previous, change.path] : previous.filter((path) => path !== change.path),
    )
  return <FileTree nodes={DEEP} open={open} onOpenChange={handleOpenChange} />
}

export const Lazy: Story = { render: () => <LazyTree /> }
