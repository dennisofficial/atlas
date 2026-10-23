import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { StackTrace } from '@dltech/atlas-ui/ai/stack-trace'

import { TYPE_ERROR_STACK } from '../fixtures/agent'

const meta = {
  title: 'AI/Stack Trace',
  component: StackTrace,
  args: { stack: TYPE_ERROR_STACK },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StackTrace>

export default meta

type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}

export const Open: Story = { args: { defaultOpen: true } }

export const WithFrameLinks: Story = {
  args: { defaultOpen: true, buildFrameHref: (frame) => '#' + frame.file + ':' + frame.lineNumber },
}
