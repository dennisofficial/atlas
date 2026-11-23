import { act } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import { NOTHING_IN_BACKGROUND, type BackgroundWork } from '@dltech/atlas-client/crew'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'
import type { QueuedTranscript } from '@/features/sessions/data/queued-transcript'
import type { BootView } from '../data/boot-view'
import { ETranscriptKind, type TranscriptRow } from '../data/transcript-items'
import { EMPTY_DETAILS } from '../panel/details/details-input'
import { ThreadPanelProvider, type ThreadPanelValue } from '../panel/thread-panel-context'
import {
  ThreadTranscript,
  type TranscriptRewind,
  type TranscriptSummarise,
} from '../thread-transcript'
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

type MountArgs = {
  rewind: TranscriptRewind | null
  summarise?: TranscriptSummarise | null
  client?: QueryClient
  rows?: TranscriptRow[]
  failureCard?: RunFailureCardProps | null
  failedLabel?: string | null
  working?: boolean
  background?: BackgroundWork
  queued?: QueuedTranscript
  onLoadOlder?: () => Promise<number>
  boot?: BootView | null
  onRetryBoot?: () => void
  onOpenPodSize?: () => void
}

const treeOf = (args: MountArgs) => (
  <TestQueryProvider client={args.client ?? createTestQueryClient()}>
    <ThreadPanelProvider value={panel}>
      <ThreadTranscript
        items={args.rows ?? items}
        failureCard={args.failureCard ?? null}
        failedLabel={args.failedLabel ?? null}
        pod={null}
        working={args.working ?? false}
        background={args.background ?? NOTHING_IN_BACKGROUND}
        onRetryBoot={args.onRetryBoot ?? (() => undefined)}
        rewind={args.rewind}
        summarise={args.summarise ?? null}
        {...(args.boot === undefined ? {} : { boot: args.boot })}
        {...(args.queued === undefined ? {} : { queued: args.queued })}
        {...(args.onLoadOlder === undefined ? {} : { onLoadOlder: args.onLoadOlder })}
        {...(args.onOpenPodSize === undefined ? {} : { onOpenPodSize: args.onOpenPodSize })}
      />
    </ThreadPanelProvider>
  </TestQueryProvider>
)

export const mount = async (rewind: TranscriptRewind | null, rows: TranscriptRow[] = items) =>
  mountWith({ rewind, rows })

export const mountWith = async (args: MountArgs) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(treeOf(args)))
}

export const mountLive = async (args: MountArgs) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = async (next: MountArgs): Promise<void> => {
    await act(async () => root.render(treeOf(next)))
  }
  await render(args)
  return { render }
}

export const rewindButton = () => document.body.querySelector('button[aria-label="Rewind to here"]')
