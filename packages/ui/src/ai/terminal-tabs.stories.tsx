import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { TerminalTabs, type TerminalTab } from './terminal-tabs'

const TABS: TerminalTab[] = [
  { id: 'term-1', label: 'Terminal 1' },
  { id: 'term-2', label: 'Terminal 2' },
]

function Interactive({ tabs: initial, onNew }: { tabs: TerminalTab[]; onNew?: boolean }) {
  const [tabs, setTabs] = useState(initial)
  const [activeId, setActiveId] = useState(initial[0]?.id ?? '')

  const handleNew = () => {
    const id = `term-${tabs.length + 1}`
    setTabs([...tabs, { id, label: `Terminal ${tabs.length + 1}` }])
    setActiveId(id)
  }

  return (
    <TerminalTabs
      tabs={tabs}
      activeId={activeId}
      onActiveChange={setActiveId}
      onNew={onNew ? handleNew : undefined}
    />
  )
}

const meta = {
  title: 'AI/Terminal Tabs',
  component: TerminalTabs,
  args: { tabs: TABS, activeId: 'term-1', onActiveChange: () => undefined },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-96 rounded-lg border border-border bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TerminalTabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithNewTerminal: Story = {
  render: (args) => <Interactive tabs={args.tabs} onNew />,
}

export const Overflowing: Story = {
  render: () => (
    <Interactive
      tabs={Array.from({ length: 9 }, (_, index) => ({
        id: `term-${index + 1}`,
        label: `Terminal ${index + 1}`,
      }))}
      onNew
    />
  ),
}
