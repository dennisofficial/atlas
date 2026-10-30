import { useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import {
  failedAgentsOf,
  runAttentionCopy,
  runAttentionOf,
  type InFlightStep,
} from '@dltech/atlas-client/transcript'
import { providerLabelOf, type Event } from '@dltech/atlas-core'
import type { RunAttentionStripProps } from '@dltech/atlas-ui/ai/run-attention-strip'

import { PROVIDERS_HREF } from '@/features/settings/settings-nav'

import type { ThreadPanelValue } from '../panel/thread-panel-context'
import { runAttentionActionsOf } from './run-attention-actions'
import { runFailedLabelOf } from './run-failed-label'
import type { ThreadSource } from './thread-source'
import { useAccountLabel } from './use-account-label'

export const RETRY_LOST = 'Could not reach the sandbox to retry the run'
export const RESUME_LOST = 'Could not reach the sandbox to resume the run'
export const DISMISS_UNSUPPORTED = 'Could not dismiss the failure — the sandbox needs an update'

export type RunAttentionView = {
  strip: RunAttentionStripProps | null
  failedLabel: string | null
}

const NONE: RunAttentionView = { strip: null, failedLabel: null }

export function useRunAttention(args: {
  events: readonly Event[]
  live: readonly InFlightStep[]
  source: Pick<ThreadSource, 'working' | 'live' | 'channel' | 'retry' | 'dismissFailure'>
  commands: {
    setModelOpen: (open: boolean) => void
    handleCommand: (text: string) => Promise<boolean>
  }
  panel: Pick<ThreadPanelValue, 'openAgent'>
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
    () => runAttentionOf({ events, live, working, turnInFlight: working, channelReady }),
    [events, live, working, channelReady],
  )

  const handleRetry = useCallback(() => {
    if (!retry()) toast.error(RETRY_LOST)
  }, [retry])
  const handleResume = useCallback(() => {
    if (!retry({ resume: true })) toast.error(RESUME_LOST)
  }, [retry])
  const handleFixCredential = useCallback(() => router.push(PROVIDERS_HREF), [router])

  return useMemo(() => {
    if (attention === null) return NONE
    const { failure, failureSeq } = attention
    const accountId = failure?.accountId
    const copy = runAttentionCopy({
      attention,
      providerLabel: providerLabelOf(failure?.providerId),
      accountLabel: accountId === undefined ? undefined : accountLabelOf(accountId),
    })
    const agentId = failure?.agent?.agentId ?? failedAgentsOf(events).at(-1)?.agentId
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
      failedLabel: failure === null ? null : runFailedLabelOf({ events, failureSeq }),
    }
  }, [
    attention,
    events,
    accountLabelOf,
    dismissFailure,
    handleRetry,
    handleResume,
    handleFixCredential,
    openModelPicker,
    openAgent,
    compact,
  ])
}
