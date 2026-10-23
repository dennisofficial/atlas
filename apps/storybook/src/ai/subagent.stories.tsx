import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { EToolKind, EToolState, Subagent } from '@dltech/atlas-ui/ai/subagent'

const meta = {
  title: 'AI/Subagent',
  component: Subagent,
  args: {
    name: 'research',
    elapsed: '48s',
    defaultOpen: true,
    model: 'claude-sonnet',
    tools: ['bash', 'read'],
    prompt: 'Find out why image optimization reruns on every deploy.',
    calls: [
      { label: 'grep -rn cacheKey scripts', output: 'scripts/optimize-images.ts:14' },
      {
        label: 'scripts/optimize-images.ts',
        kind: EToolKind.Read,
        output: 'const cacheKey = commitSha;',
      },
    ],
    result: 'The cache is keyed on the commit SHA.',
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Subagent>

export default meta

type Story = StoryObj<typeof meta>

export const Done: Story = {}

export const Running: Story = {
  args: {
    running: true,
    elapsed: undefined,
    result: undefined,
    calls: [
      { label: 'grep -rn cacheKey scripts', output: 'scripts/optimize-images.ts:14' },
      { label: 'sed -n 13,15p scripts/optimize-images.ts', state: EToolState.Running },
    ],
  },
}

export const Minimal: Story = {
  args: { model: undefined, tools: [], prompt: undefined, calls: [] },
}
