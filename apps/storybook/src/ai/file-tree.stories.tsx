import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { FileTree } from '@dltech/atlas-ui/ai/file-tree'

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
