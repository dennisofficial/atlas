import type { Meta, StoryObj } from '@storybook/react'
import { ChevronRightIcon, FileIcon } from 'lucide-react'

import { Button } from '#components/button'

import { DetailRow } from './detail-row'

const meta = {
  title: 'AI/Detail Row',
  component: DetailRow,
  args: { label: 'plans', icon: <FileIcon />, onClick: () => {} },
  decorators: [
    (Story) => (
      <div className="flex w-80 flex-col">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DetailRow>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithMeta: Story = { args: { label: 'reviewer', meta: '2m' } }

export const Current: Story = { args: { current: true } }

export const Nested: Story = { args: { icon: <ChevronRightIcon />, indent: 16 } }

export const LongLabel: Story = {
  args: { label: 'a-very-long-directory-name/with/a/deeply/nested/path/file.md', meta: '12k' },
}

export const WithDetail: Story = {
  args: {
    label: 'git push origin main',
    mono: true,
    icon: undefined,
    onClick: undefined,
    detail: 'this thread, this command',
  },
}

export const RevealedActions: Story = {
  args: {
    label: 'git push origin main',
    mono: true,
    icon: undefined,
    onClick: undefined,
    detail: 'this thread, this command',
    revealActions: true,
    actions: (
      <Button variant="ghost" size="xs">
        Revoke
      </Button>
    ),
  },
}
