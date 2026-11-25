import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import type { SessionNameOf } from '../rows'
import { queuedLabelOf, QUEUED_ROW_OPACITY, type QueuedDockState } from '../session/queued-dock'
import { ThreadRowView } from './thread-row'

export const QueuedDock = ({
  dock,
  threadId,
  sessionId,
  sessionNameOf,
}: {
  dock: QueuedDockState
  threadId: string | undefined
  sessionId: string | undefined
  sessionNameOf?: SessionNameOf | undefined
}) => {
  if (dock.rows.length === 0) return null
  const label = queuedLabelOf(dock)
  return (
    <View style={styles.root} accessibilityLabel="Queued">
      {dock.rows.map(({ id, row }) => (
        <View key={id} style={styles.dimmed}>
          <ThreadRowView
            row={row}
            threadId={threadId}
            sessionId={sessionId}
            sessionNameOf={sessionNameOf}
            queuedLabel={label}
          />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    gap: space(1),
    paddingBottom: space(2),
    paddingHorizontal: space(4),
  },
  dimmed: {
    opacity: QUEUED_ROW_OPACITY,
  },
})
