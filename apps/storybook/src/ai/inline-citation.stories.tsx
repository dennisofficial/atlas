import type { Meta, StoryObj } from '@storybook/react-vite'

import { InlineCitation } from '@dltech/atlas-ui/ai/inline-citation'

const meta = {
  title: 'AI/Inline Citation',
  component: InlineCitation,
  args: { url: 'https://ui.shadcn.com/docs/ai-elements/base/tool', title: 'Tool — shadcn/ui' },
} satisfies Meta<typeof InlineCitation>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const InSentence: Story = {
  args: {
    excerpt:
      'A tool is a plain TraceLine while it runs, and a TraceCollapsible once its output arrives.',
  },
  render: (args) => (
    <p className="max-w-md text-sm leading-relaxed">
      A running tool is a plain line that becomes collapsible once output arrives{' '}
      <InlineCitation {...args} />, and approvals sit outside the trace.
    </p>
  ),
}

export const NoTitle: Story = {
  args: { title: undefined, url: 'https://base-ui.com/react/components/collapsible' },
}
