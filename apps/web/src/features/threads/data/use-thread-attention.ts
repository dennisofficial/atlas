import type { InFlightStep } from '@dltech/atlas-client/transcript'
import type { Event } from '@dltech/atlas-core'
import type { WaitingForModelWire } from '@dltech/atlas-wire/web'

import type { ThreadPanelValue } from '../panel/thread-panel-context'
import type { ThreadSource } from './thread-source'
import { useAccountDirectory } from './use-account-directory'
import {
  snapshotOfWire,
  useModelAvailability,
  type ModelAvailability,
} from './use-model-availability'
import { useRoster } from './use-roster'
import { useRunAttention, type RunAttentionView } from './use-run-attention'

export type ThreadAttention = {
  attention: RunAttentionView
  availability: ModelAvailability
}

export function useThreadAttention(args: {
  threadId: string
  events: readonly Event[]
  live: readonly InFlightStep[]
  source: Parameters<typeof useRunAttention>[0]['source']
  commands: Parameters<typeof useRunAttention>[0]['commands']
  panel: Pick<ThreadPanelValue, 'openAgent'>
  waitingSnapshot: WaitingForModelWire | null | undefined
}): ThreadAttention {
  const { threadId, events, live, source, commands, panel, waitingSnapshot } = args
  const { channel } = source
  const accounts = useAccountDirectory()
  const roster = useRoster(channel)
  const availability = useModelAvailability({
    threadId,
    events,
    channel,
    snapshot: waitingSnapshot,
    accounts,
    roster,
    openAgent: panel.openAgent,
  })
  const attention = useRunAttention({
    events,
    live,
    source,
    commands,
    panel,
    waiting: { live: availability.waitingLive, snapshot: snapshotOfWire(waitingSnapshot) },
  })
  return { attention, availability }
}
