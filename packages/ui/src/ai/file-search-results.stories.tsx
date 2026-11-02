import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { EFileChange } from './file-tree'
import { FileSearchResults, type FileSearchHit } from './file-search-results'

const HITS: FileSearchHit[] = [
  {
    path: 'apps/web/src/features/threads/panel/files-tab.tsx',
    positions: [37, 38, 39, 40, 41],
    change: EFileChange.Modified,
  },
  { path: 'packages/ui/src/ai/file-tree.tsx', positions: [22, 23, 24, 25, 26] },
  { path: 'docs/files.md', positions: [5, 6, 7, 8], ignored: true },
  { path: 'packages/core/src/files/native.ts', positions: [], change: EFileChange.Added },
]

const meta = {
  title: 'AI/File Search Results',
  component: FileSearchResults,
  args: { hits: HITS, active: 0 },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileSearchResults>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

function Hoverable() {
  const [active, setActive] = useState(1)
  return <FileSearchResults hits={HITS} active={active} onActiveChange={setActive} />
}

export const Hoverable_: Story = { name: 'Hover moves the active row', render: () => <Hoverable /> }
