import type { Meta, StoryObj } from '@storybook/react'

import { RunFailureBanner } from './run-failure-banner'

const SETTINGS = {
  settingsHref: '/settings/providers',
  settingsLabel: 'Open Providers settings',
}
const handleRetry = () => undefined

const meta = {
  title: 'AI/RunFailureBanner',
  component: RunFailureBanner,
  args: {
    title: 'The run failed',
    detail: 'Something went wrong.',
    onRetry: handleRetry,
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RunFailureBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Auth: Story = {
  args: {
    title: 'inference.net rejected the API key',
    detail:
      'inference.net rejected the API key for Work key. Update it in Settings → Providers, then retry.',
    ...SETTINGS,
  },
}

export const Quota: Story = {
  args: {
    title: 'Work key is out of credits',
    detail:
      'OpenAI reports no remaining credits or quota for Work key. Top up in Settings → Providers or switch model, then retry.',
    ...SETTINGS,
  },
}

export const RateLimited: Story = {
  args: {
    title: 'Anthropic rate limited the run',
    detail: 'Anthropic is rate limiting requests for this account. Wait a moment and retry.',
  },
}

export const Network: Story = {
  args: {
    title: "Couldn't reach OpenRouter",
    detail:
      'The connection to OpenRouter dropped before the run finished. Check your network, then retry.',
  },
}

export const Other: Story = {
  args: {
    title: 'The run failed',
    detail: 'AI_APICallError: unexpected response from the model.',
  },
}

export const RetryDisabledWhileBusy: Story = {
  args: {
    title: 'Anthropic rate limited the run',
    detail: 'Anthropic is rate limiting requests for this account. Wait a moment and retry.',
    retryDisabled: true,
  },
}
