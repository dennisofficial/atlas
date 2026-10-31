import type { Meta, StoryObj } from '@storybook/react'

import { Input } from '#components/input'

import { RunAttentionStrip, type RunAttentionAction } from './run-attention-strip'

const BUSY = 'Wait for the current run to finish.'
const handleSelect = () => undefined

interface ActionSeed {
  id: string
  label: string
  disabled?: boolean
  pending?: boolean
  pendingLabel?: string
}

const actionsOf = (seeds: ActionSeed[]): RunAttentionAction[] =>
  seeds.map((seed, index) => ({
    id: seed.id,
    label: seed.label,
    primary: index === 0,
    disabled: seed.disabled ?? false,
    pending: seed.pending,
    pendingLabel: seed.pendingLabel,
    onSelect: handleSelect,
  }))

const RETRY: ActionSeed = { id: 'retry', label: 'Retry' }
const META = '1.2s · ↓4.1k'

const meta = {
  title: 'AI/RunAttentionStrip',
  component: RunAttentionStrip,
  args: {
    title: 'The run failed',
    detail: 'Something went wrong.',
    meta: META,
    actions: actionsOf([RETRY]),
    onDismiss: handleSelect,
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-3xl px-4">
        <Story />
        <div className="relative rounded-xl border bg-card p-2">
          <Input placeholder="Ask Atlas anything" aria-label="Mock composer" />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof RunAttentionStrip>

export default meta
type Story = StoryObj<typeof meta>

export const Auth: Story = {
  args: {
    title: 'inference.net rejected the API key',
    detail: 'inference.net rejected the API key for Work key. Update it, then retry.',
    actions: actionsOf([
      { id: 'fix-credential', label: 'Fix credential' },
      { id: 'retry', label: 'Retry' },
    ]),
  },
}

export const Quota: Story = {
  args: {
    title: 'Quota exhausted',
    detail: 'The provider reports no remaining quota for this key.',
    actions: actionsOf([
      { id: 'switch-model', label: 'Switch model' },
      { id: 'retry', label: 'Retry' },
    ]),
  },
}

export const RateLimited: Story = {
  args: {
    title: 'Rate limited',
    detail: 'The provider asked us to slow down. Retry in a moment.',
    actions: actionsOf([RETRY, { id: 'switch-model', label: 'Switch model' }]),
  },
}

export const Network: Story = {
  args: {
    title: 'Connection lost',
    detail: 'The stream dropped before the provider finished responding.',
    actions: actionsOf([RETRY]),
  },
}

export const Overloaded: Story = {
  args: {
    title: 'Provider overloaded',
    detail: 'The provider is temporarily over capacity.',
    actions: actionsOf([RETRY, { id: 'switch-model', label: 'Switch model' }]),
  },
}

export const MissingCredential: Story = {
  args: {
    title: 'No credential for this model',
    detail: 'Connect a provider for this model in Settings, then retry.',
    meta: undefined,
    actions: actionsOf([{ id: 'fix-credential', label: 'Open settings' }, RETRY]),
  },
}

export const ContextOverflow: Story = {
  args: {
    title: 'Context window full',
    detail: 'The conversation no longer fits the model. Compact it to continue.',
    actions: actionsOf([
      { id: 'compact', label: 'Compact' },
      { id: 'switch-model', label: 'Switch model' },
    ]),
  },
}

export const LoopGuard: Story = {
  args: {
    title: 'Run stopped by the loop guard',
    detail: 'The agent repeated the same tool call without progress.',
    actions: actionsOf([RETRY]),
  },
}

export const AgentFailed: Story = {
  args: {
    title: 'Agent “explore” failed',
    detail: 'The sub-agent ended with an error while searching the repository.',
    actions: actionsOf([{ id: 'open-agent', label: 'Open agent' }, RETRY]),
  },
}

export const Interrupted: Story = {
  args: {
    title: 'The run was interrupted',
    detail: 'The session restarted mid-run. Resume where it left off.',
    actions: actionsOf([{ id: 'resume', label: 'Resume' }]),
  },
}

export const Busy: Story = {
  args: {
    busyReason: BUSY,
    actions: actionsOf([
      { id: 'retry', label: 'Retry', disabled: true },
      { id: 'switch-model', label: 'Switch model', disabled: true },
    ]),
  },
}

export const PendingRetry: Story = {
  args: {
    actions: actionsOf([
      { id: 'retry', label: 'Retry', pending: true, pendingLabel: 'Retrying…' },
      { id: 'switch-model', label: 'Switch model', disabled: true },
    ]),
  },
}

export const NoDismiss: Story = {
  args: { onDismiss: undefined },
}
