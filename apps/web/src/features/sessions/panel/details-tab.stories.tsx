import { ESubscriptionActor, ESubscriptionTone } from '@dltech/atlas-core'
import type { SubscriptionListRow } from '@dltech/atlas-plugin-github/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { paneValueFixture, populatedPaneValue, subscriptionRowFixture } from './__tests__/fixture'
import { SessionDetailsTab } from './details-tab'
import { SessionPaneProvider } from './pane-value'

const meta = {
  title: 'Sessions/Pane details',
  parameters: { layout: 'fullscreen' },
}

export default meta

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const pane = (value: ReturnType<typeof populatedPaneValue>) => (
  <div className="h-[36rem] w-[26rem] border-r bg-card">
    <QueryClientProvider client={queryClient}>
      <SessionPaneProvider value={value}>
        <SessionDetailsTab />
      </SessionPaneProvider>
    </QueryClientProvider>
  </div>
)

export const Populated = {
  render: () => pane(populatedPaneValue()),
}

export const Empty = {
  render: () => pane(paneValueFixture()),
}

const subscriptionRows = (): readonly SubscriptionListRow[] => {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  return [
    subscriptionRowFixture({
      id: 'sub_2443',
      number: 2443,
      presentation: {
        icon: 'git-pull-request',
        tone: ESubscriptionTone.Open,
        title: '#2443 Pluggable sandbox providers',
        meta: ['Pull request', 'comments · CI'],
      },
    }),
    subscriptionRowFixture({
      id: 'sub_2441',
      number: 2441,
      held: 2,
      presentation: {
        icon: 'git-pull-request',
        tone: ESubscriptionTone.Merged,
        title: '#2441 Agent37 as default provider',
        meta: ['Pull request', 'all events'],
      },
    }),
    subscriptionRowFixture({
      id: 'sub_deploy',
      provider: 'github.workflow-run',
      number: undefined,
      createdBy: ESubscriptionActor.Operator,
      expiresAt,
      presentation: {
        icon: 'circle-play',
        tone: ESubscriptionTone.Running,
        title: 'deploy.yml@main',
        meta: ['Workflow run'],
      },
    }),
    subscriptionRowFixture({
      id: 'sub_2424',
      number: 2424,
      presentation: {
        icon: 'git-pull-request',
        tone: ESubscriptionTone.Open,
        title: '#2424 Resize outcomes',
        meta: ['Pull request', 'state only'],
      },
    }),
  ]
}

export const Subscriptions = {
  render: () =>
    pane(
      paneValueFixture({
        view: { ...populatedPaneValue().view, subscriptionRows: subscriptionRows() },
      }),
    ),
}
