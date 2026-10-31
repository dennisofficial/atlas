import { act } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'
import { ETranscriptKind, type TranscriptRow } from '../data/transcript-items'
import { EMPTY_DETAILS } from '../panel/details/details-input'
import { ThreadPanelProvider, type ThreadPanelValue } from '../panel/thread-panel-context'
import { ThreadTranscript, type TranscriptRewind } from '../thread-transcript'
import type { RunFailureCardProps } from '../transcript/run-failure-card'

const panel: ThreadPanelValue = {
  threadId: 'thr_1',
  channel: null,
  loaded: true,
  error: null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  openDetails: () => undefined,
  details: EMPTY_DETAILS,
  clearAgent: () => undefined,
  contextPath: undefined,
  openContextFile: () => undefined,
  closeContextFile: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

export const items: TranscriptRow[] = [
  {
    kind: ETranscriptKind.User,
    id: 'evt_2',
    text: 'try again',
    at: '2026-10-28T10:00:00.000Z',
  },
]

export const mount = async (rewind: TranscriptRewind | null, rows: TranscriptRow[] = items) =>
  mountWith({ rewind, rows })

export const mountWith = async (args: {
  rewind: TranscriptRewind | null
  client?: QueryClient
  rows?: TranscriptRow[]
  failureCard?: RunFailureCardProps | null
  failedLabel?: string | null
}) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <TestQueryProvider client={args.client ?? createTestQueryClient()}>
        <ThreadPanelProvider value={panel}>
          <ThreadTranscript
            items={args.rows ?? items}
            failureCard={args.failureCard ?? null}
            failedLabel={args.failedLabel ?? null}
            pod={null}
            working={false}
            onRetryBoot={() => undefined}
            rewind={args.rewind}
          />
        </ThreadPanelProvider>
      </TestQueryProvider>,
    ),
  )
}

export const rewindButton = () => document.body.querySelector('button[aria-label="Rewind to here"]')
