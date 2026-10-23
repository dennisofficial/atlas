import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { Context } from './context'
import { EEffort, ModelSelector } from './model-selector'
import { PromptInput, type PromptAttachment } from './prompt-input'

import { MODELS } from '../fixtures/agent'

const meta = {
  title: 'AI/Prompt Input',
  component: PromptInput,
  decorators: [
    (Story) => (
      <div className="w-[40rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PromptInput>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithText: Story = {
  args: { defaultValue: 'Add a story for every AI pattern' },
}

export const Busy: Story = {
  args: { defaultValue: 'Run the full suite', busy: true },
}

export const WithAttachments: Story = {
  args: {
    attachments: [
      { id: '1', name: 'typecheck.log' },
      { id: '2', name: 'screenshot.png' },
    ],
  },
}

function ComposedPrompt() {
  const [model, setModel] = useState('claude-sonnet')
  const [effort, setEffort] = useState(EEffort.Medium)
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [sent, setSent] = useState<string[]>([])

  const handleAttach = (files: File[]) =>
    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({ id: `${file.name}-${file.size}`, name: file.name })),
    ])
  const handleRemove = (id: string) =>
    setAttachments((current) => current.filter((item) => item.id !== id))
  const handleSubmit = (text: string) => setSent((current) => [...current, text])

  return (
    <div className="flex flex-col gap-3">
      {sent.map((text, index) => (
        <p key={index} className="rounded-md bg-muted px-3 py-2 text-sm">
          {text}
        </p>
      ))}
      <PromptInput
        attachments={attachments}
        onAttachFiles={handleAttach}
        onRemoveAttachment={handleRemove}
        onSubmit={handleSubmit}
      >
        <ModelSelector
          models={MODELS}
          value={model}
          onValueChange={setModel}
          effort={effort}
          onEffortChange={setEffort}
        />
        <Context used={52_400} limit={200_000} className="ml-auto" />
      </PromptInput>
    </div>
  )
}

export const Composed: Story = {
  render: () => <ComposedPrompt />,
}
