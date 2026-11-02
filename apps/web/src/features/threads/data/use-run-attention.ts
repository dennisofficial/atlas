import { useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import {
  runAttentionCopy,
  runAttentionOf,
  type InFlightStep,
} from '@dltech/atlas-client/transcript'
import { ERunRemedy, providerLabelOf, type Event, type WaitingForModel } from '@dltech/atlas-core'
import type { RunAttentionStripProps } from '@dltech/atlas-ui/ai/run-attention-strip'

import { PROVIDERS_HREF } from '@/features/settings/settings-nav'
import type { RunFailureCardProps } from '../transcript/run-failure-card'

import type { ThreadPanelValue } from '../panel/thread-panel-context'
import { runAttentionActionsOf } from './run-attention-actions'
import { attentionKeyOf } from './run-attention-pending'
import { runFailedLabelOf } from './run-failed-label'
import type { ThreadSource } from './thread-source'
import { useAccountLabel } from './use-account-label'
import { usePendingRemedy } from './use-pending-remedy'

export const RETRY_LOST = 'Could not reach the sandbox to retry the run'
export const RESUME_LOST = 'Could not reach the sandbox to resume the run'
export const DISMISS_UNSUPPORTED = 'Could not dismiss the failure — the sandbox needs an update'

export type RunAttentionView = {
  strip: RunAttentionStripProps | null
  card: RunFailureCardProps | null
  failedLabel: string | null
}

const NONE: RunAttentionView = { strip: null, card: null, failedLabel: null }

export function useRunAttention(args: {
  events: readonly Event[]
  live: readonly InFlightStep[]
  source: Pick<ThreadSource, 'working' | 'live' | 'channel' | 'retry' | 'dismissFailure'>
  commands: {
    setModelOpen: (open: boolean) => void
    handleCommand: (text: string) => Promise<boolean>
  }
  panel: Pick<ThreadPanelValue, 'openAgent'>
  waiting?: { live: readonly WaitingForModel[] | null; snapshot: WaitingForModel | null }
}): RunAttentionView {
  const { events, live, source, commands, panel } = args
  const { openAgent } = panel
  const { setModelOpen, handleCommand } = commands
  const openModelPicker = useCallback(() => setModelOpen(true), [setModelOpen])
  const compact = useCallback(() => void handleCommand('/compact'), [handleCommand])
  const { working, retry, dismissFailure } = source
  const router = useRouter()
  const accountLabelOf = useAccountLabel()
  const channelReady = source.live && source.channel !== null

  const attention = useMemo(
    () =>
      runAttentionOf({
        events,
        live,
        working,
        turnInFlight: working,
        channelReady,
        waitingLive: args.waiting?.live ?? null,
        waitingSnapshot: args.waiting?.snapshot ?? null,
      }),
    [events, live, working, channelReady, args.waiting?.live, args.waiting?.snapshot],
  )

  const attentionKey =
    attention === null
      ? null
      : attentionKeyOf({ failureSeq: attention.failureSeq, runId: attention.runId })
  const { pending, begin, clear } = usePendingRemedy({ key: attentionKey, working })

  const handleRetry = useCallback(() => {
    if (!begin(ERunRemedy.Retry)) return
    if (retry()) return
    clear()
    toast.error(RETRY_LOST)
  }, [begin, clear, retry])
  const handleResume = useCallback(() => {
    if (!begin(ERunRemedy.Resume)) return
    if (retry({ resume: true })) return
    clear()
    toast.error(RESUME_LOST)
  }, [begin, clear, retry])
  const handleFixCredential = useCallback(() => router.push(PROVIDERS_HREF), [router])

  return useMemo(() => {
    if (attention === null || attention.modelWait !== null) return NONE
    const { failure, failureSeq } = attention
    const accountId = failure?.accountId
    const copy = runAttentionCopy({
      attention,
      providerLabel: providerLabelOf(failure?.providerId),
      accountLabel: accountId === undefined ? undefined : accountLabelOf(accountId),
    })
    const agentId = failure?.agent?.agentId
    const handleDismiss = () => {
      if (failureSeq === null) return
      if (!dismissFailure({ failureSeq })) toast.error(DISMISS_UNSUPPORTED)
    }
    return {
      strip: {
        ...copy,
        actions: runAttentionActionsOf({
          attention,
          agentId,
          pending,
          handlers: {
            retry: handleRetry,
            resume: handleResume,
            fixCredential: handleFixCredential,
            switchModel: openModelPicker,
            openAgent,
            compact,
          },
        }),
        busyReason: attention.busyReason,
        ...(attention.dismissible ? { onDismiss: handleDismiss } : {}),
      },
      card:
        failure === null
          ? null
          : {
              ...copy,
              ...(attention.dismissible ? { onDismiss: handleDismiss } : {}),
            },
      failedLabel: failure === null ? null : runFailedLabelOf({ events, failureSeq }),
    }
  }, [
    attention,
    events,
    accountLabelOf,
    pending,
    dismissFailure,
    handleRetry,
    handleResume,
    handleFixCredential,
    openModelPicker,
    openAgent,
    compact,
  ])
}
