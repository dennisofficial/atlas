import type { Meta, StoryObj } from '@storybook/react'

import { HelpTip } from './help-tip'

const meta = {
  title: 'AI/Help Tip',
  component: HelpTip,
  args: {
    label: 'Quick calls',
    children: 'Background calls: session titles, tl;dr footers and the nudge judge.',
  },
} satisfies Meta<typeof HelpTip>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

function InALabel() {
  return (
    <div className="flex flex-col gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        Main agent
        <HelpTip label="Main agent">
          Plans the work, edits code, and talks to you in the thread. Everything below follows it
          unless given its own model.
        </HelpTip>
      </span>
      <span className="flex items-center gap-1">
        Compaction
        <HelpTip label="Compaction">
          Summarises older turns when the context fills, for both auto and /compact. The summary is
          all the next turn sees.
        </HelpTip>
      </span>
    </div>
  )
}

export const NextToLabels: Story = { render: () => <InALabel /> }
