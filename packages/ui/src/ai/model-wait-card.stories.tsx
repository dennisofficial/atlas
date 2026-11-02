import type { Meta, StoryObj } from '@storybook/react'

import {
  EModelWaitNoteTone,
  ModelWaitCard,
  type ModelWaitAction,
  type ModelWaitIssueView,
} from './model-wait-card'

const handleSelect = () => undefined

const recheck: ModelWaitAction = {
  id: 'recheck',
  label: 'Recheck access',
  primary: true,
  disabled: false,
  confirm: {
    title: 'Recheck access?',
    description: 'Rechecking sends one normal model request, which may incur normal model charges.',
    confirmLabel: 'Recheck and continue',
  },
  onSelect: handleSelect,
}

const providers: ModelWaitAction = {
  id: 'providers',
  label: 'Providers',
  primary: false,
  disabled: false,
  onSelect: handleSelect,
}

const issue: ModelWaitIssueView = {
  id: 'anthropic-work',
  detail: 'Anthropic · Work account: allowance exhausted. Provider reset: not supplied.',
  meta: 'Last checked 2026-11-02 09:14 UTC',
  affectedLabel: '3 sessions waiting',
  affected: [
    { id: 'a', label: 'Root session', onOpen: handleSelect },
    { id: 'b', label: 'Reviewer agent', onOpen: handleSelect },
    {
      id: 'c',
      label: 'Builder agent with a deliberately long title that must wrap',
      onOpen: handleSelect,
    },
  ],
  actions: [recheck, providers],
}

const meta = {
  title: 'AI/ModelWaitCard',
  component: ModelWaitCard,
  args: {
    title: 'Waiting for model',
    issues: [issue],
    announcement: 'Waiting for model: Anthropic · Work account: allowance exhausted.',
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-3xl px-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModelWaitCard>

export default meta
type Story = StoryObj<typeof meta>

export const Exhausted: Story = {}

export const Paused: Story = {
  args: {
    issues: [
      {
        ...issue,
        detail: 'Anthropic · Work account: paused by you. Remove the pause to continue.',
        actions: [
          { ...recheck, id: 'remove', label: 'Remove manual pause', confirm: undefined },
          providers,
        ],
      },
    ],
  },
}

export const Pending: Story = {
  args: {
    issues: [
      {
        ...issue,
        actions: [
          { ...recheck, pending: true, pendingLabel: 'Rechecking…' },
          { ...providers, disabled: true },
        ],
      },
    ],
  },
}

export const ActionError: Story = {
  args: {
    issues: [
      {
        ...issue,
        note: {
          tone: EModelWaitNoteTone.Error,
          text: 'Could not reach the sandbox. Nothing changed.',
        },
      },
    ],
  },
}

export const NoSessions: Story = {
  args: { issues: [{ ...issue, affectedLabel: 'No sessions currently waiting', affected: [] }] },
}

export const Partial: Story = {
  args: { partialNote: 'Another model may also be waiting; open the session to see every cause.' },
}

export const TwoIssues: Story = {
  args: {
    issues: [
      issue,
      {
        ...issue,
        id: 'openai',
        detail: 'OpenAI · Personal: rate limited. Provider reset: 2026-11-02 10:00 UTC.',
      },
    ],
  },
}
