import type { ApiClient } from '@dltech/atlas-api-router'
import type { Attachment, RecordEvent } from '@dltech/atlas-core'
import type { RewindApi } from '@dltech/atlas-client/session'
import { useMemo } from 'react'

import type { MessageActionHandlers } from '../message-actions'
import type { RequestedCommandState } from './use-requested-command'
import { useMessageRewind } from './use-message-rewind'
import { useMessageSummarise } from './use-message-summarise'

const commandApiOf = (api: ApiClient | undefined): RewindApi | undefined =>
  api === undefined ? undefined : { command: (input) => api.sessions.command.mutate(input) }

export const useSessionMessageActions = (args: {
  sessionId: string
  events: readonly RecordEvent[]
  api: ApiClient | undefined
  requested: RequestedCommandState
  onRestore: (restored: { text: string; attachments: readonly Attachment[] }) => void
  onNotice: (notice: string) => void
}): MessageActionHandlers => {
  const { sessionId, events, api, requested, onRestore, onNotice } = args
  const commandApi = useMemo(() => commandApiOf(api), [api])
  const rewind = useMessageRewind({ sessionId, events, api: commandApi, onRestore, onNotice })
  const summarise = useMessageSummarise({
    sessionId,
    events,
    api: commandApi,
    requested,
    onNotice,
  })
  const { rewindPoints, handleRewind } = rewind
  const { summarisePoints, handleSummarise } = summarise
  return useMemo(
    () => ({ rewindPoints, summarisePoints, onRewind: handleRewind, onSummarise: handleSummarise }),
    [rewindPoints, summarisePoints, handleRewind, handleSummarise],
  )
}
