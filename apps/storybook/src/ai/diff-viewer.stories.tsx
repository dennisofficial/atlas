import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { DiffViewer } from '@dltech/atlas-ui/ai/diff-viewer'

import { DIFF_LINES, LONG_DIFF_LINES } from '../fixtures/agent'

const meta = {
  title: 'AI/Diff Viewer',
  component: DiffViewer,
  args: {
    path: 'packages/ui/src/tokens/semantic.ts',
    added: 4,
    removed: 2,
    hunk: '@@ -12,7 +12,21 @@',
    lines: DIFF_LINES,
  },
  argTypes: { mode: { control: 'inline-radio', options: ['inline', 'split'] } },
  decorators: [
    (Story) => (
      <div className="w-[40rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DiffViewer>

export default meta

type Story = StoryObj<typeof meta>

export const Inline: Story = {}

export const Split: Story = { args: { mode: 'split' } }

export const NoCounts: Story = {
  args: { added: undefined, removed: undefined, hunk: undefined },
}

export const LongLines: Story = { args: { lines: LONG_DIFF_LINES } }
