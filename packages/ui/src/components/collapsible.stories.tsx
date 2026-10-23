import type { Meta, StoryObj } from '@storybook/react'
import { ChevronsUpDownIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#components/collapsible'

const meta = {
  title: 'Components/Collapsible',
  component: Collapsible,
} satisfies Meta<typeof Collapsible>

export default meta

type Story = StoryObj<typeof meta>

const files = [
  'apps/web/src/app/page.tsx',
  'apps/web/src/app/layout.tsx',
  'apps/web/src/lib/session.ts',
]

export const Default: Story = {
  render: (args) => (
    <Collapsible className="flex w-80 flex-col gap-2" {...args}>
      <div className="flex items-center justify-between gap-4">
        <h4 className="text-sm font-semibold">3 files changed</h4>
        <CollapsibleTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <ChevronsUpDownIcon />
          <span className="sr-only">Toggle file list</span>
        </CollapsibleTrigger>
      </div>
      <div className="rounded-lg border border-border px-3 py-2 font-mono text-sm">{files[0]}</div>
      <CollapsibleContent className="flex flex-col gap-2">
        {files.slice(1).map((file) => (
          <div key={file} className="rounded-lg border border-border px-3 py-2 font-mono text-sm">
            {file}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  ),
}

export const DefaultOpen: Story = {
  render: (args) => (
    <Collapsible className="flex w-80 flex-col gap-2" defaultOpen {...args}>
      <CollapsibleTrigger render={<Button variant="outline" />}>Reasoning</CollapsibleTrigger>
      <CollapsibleContent className="text-sm text-muted-foreground">
        The reconnect timer is shared across tabs, so the second tab never fires its backoff.
      </CollapsibleContent>
    </Collapsible>
  ),
}
