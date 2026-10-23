import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { EMarkdownEditorVariant, MarkdownEditor } from '@dltech/atlas-ui/ai/markdown-editor'

import { GLOBAL_INSTRUCTIONS, GLOBAL_INSTRUCTIONS_RICH } from '../fixtures/settings-agent'
import { GLOBAL_MEMORIES } from '../fixtures/settings-memory-entries'

const MEMORY_BODY = GLOBAL_MEMORIES[0]?.body ?? ''

const meta = {
  title: 'AI/MarkdownEditor',
  component: MarkdownEditor,
  args: { value: MEMORY_BODY, onChange: () => {}, placeholder: 'Write markdown…' },
  decorators: [
    (Story) => (
      <div className="w-[40rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return <MarkdownEditor {...args} value={value} onChange={setValue} />
  },
} satisfies Meta<typeof MarkdownEditor>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { value: '' } }

export const ReadOnly: Story = { args: { readOnly: true } }

export const SourceMode: Story = { args: { defaultSourceMode: true } }

export const OverLimit: Story = { args: { maxLength: 40 } }

export const Unparseable: Story = { args: { value: GLOBAL_INSTRUCTIONS, className: 'h-96' } }

export const Document: Story = {
  args: { value: GLOBAL_INSTRUCTIONS_RICH, variant: EMarkdownEditorVariant.Document },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-3xl px-8 py-10">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'fullscreen' },
}
