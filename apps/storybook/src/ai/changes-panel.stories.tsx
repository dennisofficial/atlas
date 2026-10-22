import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChangesPanel, type ChangesPanelProps } from '@dltech/atlas-ui/ai/changes-panel'

import { CHANGED_FILES, CHANGE_SCOPES } from './changes-panel.fixtures'

const meta = {
  title: 'AI/Changes Panel',
  component: ChangesPanel,
  args: { files: CHANGED_FILES, scopes: CHANGE_SCOPES, scope: 'all' },
  decorators: [
    (Story) => (
      <div className="h-[34rem] w-[26rem] max-w-full overflow-hidden rounded-xl border border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChangesPanel>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const FileExpanded: Story = {
  args: { defaultExpanded: ['packages/ui/src/ai/task-dock.tsx'] },
}

export const SingleFile: Story = {
  args: {
    files: CHANGED_FILES.slice(3, 4),
    defaultExpanded: ['packages/ui/src/styles/theme.css'],
  },
}

export const NoChanges: Story = { args: { files: [] } }

function InteractivePanel(args: ChangesPanelProps) {
  const [scope, setScope] = useState(args.scope)
  return <ChangesPanel {...args} scope={scope} onScopeChange={setScope} />
}

export const Interactive: Story = {
  render: (args) => <InteractivePanel {...args} />,
}
