import { EAgentStatus, ESubscriptionActor, ESubscriptionTone } from '@dltech/atlas-core'
import { sessionViewOutputSchema } from '@dltech/atlas-protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

import { contextMirrorKey } from '../data/context-files'
import { sessionViewModelOf } from '../data/session-view-model'
import { paneValueFixture } from './__tests__/fixture'
import { SessionCheckoutScope } from './checkout-scope'
import { SessionDetailsCard } from './details-card'
import realSession from './details-card.fixture.json'
import contextPaths from './details-context.fixture.json'
import checkouts from './details-checkouts.fixture.json'
import pluginViews from './details-plugins.fixture.json'
import { ThreadPanelProvider } from '@/features/threads/panel/thread-panel-context'

import { panelValueOf } from '../data/panel-value'
import { SessionPaneProvider } from './pane-value'

const sessionId = 'f44fd175-c68e-4db3-a460-7d9648dd1040'
const output = sessionViewOutputSchema.parse({ ...realSession, pluginViews, checkouts })
const view = sessionViewModelOf(output)
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } },
})
queryClient.setQueryData(contextMirrorKey(sessionId), {
  files: contextPaths.map((path) => ({ path })),
})

function DetailsCardPreview() {
  const [added, setAdded] = useState(false)
  const [open, setOpen] = useState(true)
  const handleToggleRows = () => setAdded((current) => !current)
  const handleToggleCard = () => setOpen((current) => !current)
  const crewRows = added
    ? [
        {
          agentId: 'motion-demo',
          agentType: 'explore',
          intent: 'Inspect details card motion',
          status: EAgentStatus.Running,
          turns: 0,
          toolCalls: 0,
          startedAt: new Date().toISOString(),
        },
        ...view.crewRows,
      ]
    : view.crewRows
  const subscriptionRows = added
    ? [
        ...view.subscriptionRows,
        {
          id: 'motion-demo',
          createdBy: ESubscriptionActor.Operator,
          target: {},
          presentation: {
            icon: 'bell',
            tone: ESubscriptionTone.Running,
            title: 'Motion preview',
            meta: ['Story control'],
          },
        },
      ]
    : view.subscriptionRows
  const value = paneValueFixture({
    sessionId,
    title: 'T3 Code Inspiration',
    startedAt: '2026-11-27T20:28:00.000Z',
    status: output.status,
    checkouts: output.checkouts,
    view: {
      ...view,
      crewRows,
      crew: {
        running: crewRows.filter((row) => row.status === EAgentStatus.Running).length,
        total: crewRows.length,
      },
      subscriptionRows,
    },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <ThreadPanelProvider value={storyPanel}>
        <SessionPaneProvider value={value}>
          <SessionCheckoutScope>
            <div
              data-theme="dark"
              className="@container relative h-[calc(100dvh-4rem)] w-full bg-background text-foreground"
            >
              <div className="flex gap-4 p-4">
                <button type="button" onClick={handleToggleRows}>
                  Toggle demo rows
                </button>
                <button type="button" onClick={handleToggleCard}>
                  Toggle details card
                </button>
              </div>
              <SessionDetailsCard open={open} onOpenChanges={() => undefined} />
            </div>
          </SessionCheckoutScope>
        </SessionPaneProvider>
      </ThreadPanelProvider>
    </QueryClientProvider>
  )
}

const storyPanel = panelValueOf({
  sessionId: 'story',
  working: false,
  agentId: undefined,
  openAgent: () => undefined,
  clearAgent: () => undefined,
  openTab: () => undefined,
  requestOpen: () => undefined,
})

export default {
  title: 'Sessions/Details card',
  parameters: { layout: 'fullscreen' },
}

export const RealSession = { render: () => <DetailsCardPreview /> }
