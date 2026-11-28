import type { RecordEvent, SummariseReach } from '@dltech/atlas-core'
import {
  requestSummarise,
  summariseCopyOf,
  summarisePointsOf,
  type SummariseApi,
} from '@dltech/atlas-client/session'
import { eventIdOfEntryKey } from '@dltech/atlas-client/transcript'
import { useCallback, useMemo } from 'react'
import { Alert } from 'react-native'

import type { MessageRow } from '../rows'
import type { RequestedCommandState } from './use-requested-command'

const NO_POINTS: ReadonlyMap<string, SummariseReach> = new Map()

export const useMessageSummarise = (args: {
  sessionId: string
  events: readonly RecordEvent[]
  api: SummariseApi | undefined
  requested: RequestedCommandState
  onNotice: (notice: string) => void
}): {
  summarisePoints: ReadonlyMap<string, SummariseReach>
  handleSummarise: (row: MessageRow) => void
} => {
  const { sessionId, events, api, requested, onNotice } = args
  const { blocking, track } = requested
  const busy = blocking !== undefined
  const summarisePoints = useMemo(
    () => (busy ? NO_POINTS : summarisePointsOf(events)),
    [busy, events],
  )

  const handleSummarise = useCallback(
    (row: MessageRow) => {
      if (api === undefined) return
      const pick = summarisePoints.get(eventIdOfEntryKey(row.id))
      if (pick === undefined) return
      const copy = summariseCopyOf(pick)
      Alert.alert(copy.title, copy.description, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Summarise',
          onPress: () => {
            track({
              name: 'summarise',
              request: () => requestSummarise({ api, sessionId, throughSeq: pick.throughSeq }),
            }).catch(() => onNotice('Summarise failed. Try again.'))
          },
        },
      ])
    },
    [api, summarisePoints, sessionId, track, onNotice],
  )

  return { summarisePoints, handleSummarise }
}
