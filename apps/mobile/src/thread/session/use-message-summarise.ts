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

export const useMessageSummarise = (args: {
  sessionId: string
  events: readonly RecordEvent[]
  api: SummariseApi | undefined
  onNotice: (notice: string) => void
}): {
  summarisePoints: ReadonlyMap<string, SummariseReach>
  handleSummarise: (row: MessageRow) => void
} => {
  const { sessionId, events, api, onNotice } = args
  const summarisePoints = useMemo(() => summarisePointsOf(events), [events])

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
            requestSummarise({ api, sessionId, throughSeq: pick.throughSeq }).catch(() =>
              onNotice('Summarise failed. Try again.'),
            )
          },
        },
      ])
    },
    [api, summarisePoints, sessionId, onNotice],
  )

  return { summarisePoints, handleSummarise }
}
