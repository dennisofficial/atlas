import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import type { SessionNameOf } from '../rows'
import { queuedLabelOf, type QueuedDockState } from '../v2/queued-dock'
import { ThreadRowView } from './thread-row'

export const QueuedDock = ({
  dock,
  threadId,
  sessionId,
  sessionNameOf,
  onEdit,
  onRemove,
}: {
  dock: QueuedDockState
  threadId: string | undefined
  sessionId: string | undefined
  sessionNameOf?: SessionNameOf | undefined
  onEdit: (inboxId: string) => void
  onRemove: (inboxId: string) => void
}) => {
  if (dock.rows.length === 0) return null
  const label = queuedLabelOf(dock)
  return (
    <View style={styles.root} accessibilityLabel="Queued">
      {dock.rows.map(({ id, row, withdraw }) => (
        <View key={id} style={styles.dim}>
          <ThreadRowView
            row={row}
            threadId={threadId}
            sessionId={sessionId}
            {...(sessionNameOf === undefined ? {} : { sessionNameOf })}
            {...(withdraw === undefined
              ? {}
              : {
                  queued: {
                    label,
                    disabled: withdraw.disabled,
                    onEdit: () => onEdit(withdraw.inboxId),
                    onRemove: () => onRemove(withdraw.inboxId),
                  },
                })}
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
  dim: {
    opacity: 0.5,
  },
})
