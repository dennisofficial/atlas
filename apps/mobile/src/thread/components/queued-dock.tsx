import { Button, EButtonSize, EButtonVariant } from '@dltech/atlas-ui-native'
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
  onEdit,
  onRemove,
}: {
  dock: QueuedDockState
  threadId: string | undefined
  sessionId: string | undefined
  sessionNameOf?: SessionNameOf | undefined
  onEdit?: ((inboxId: number) => void) | undefined
  onRemove?: ((inboxId: number) => void) | undefined
}) => {
  if (dock.rows.length === 0) return null
  const label = queuedLabelOf(dock)
  return (
    <View style={styles.root} accessibilityLabel="Queued">
      {dock.rows.map(({ id, row, withdrawInboxId }) => (
        <View key={id} style={styles.row}>
          <View style={styles.dimmed}>
            <ThreadRowView
              row={row}
              threadId={threadId}
              sessionId={sessionId}
              sessionNameOf={sessionNameOf}
              queuedLabel={label}
            />
          </View>
          {withdrawInboxId === undefined ||
          onEdit === undefined ||
          onRemove === undefined ? null : (
            <View style={styles.actions}>
              <Button
                label="Edit"
                size={EButtonSize.Sm}
                variant={EButtonVariant.Ghost}
                onPress={() => onEdit(withdrawInboxId)}
              />
              <Button
                label="Remove"
                size={EButtonSize.Sm}
                variant={EButtonVariant.Ghost}
                onPress={() => onRemove(withdrawInboxId)}
              />
            </View>
          )}
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
  row: {
    gap: space(1),
  },
  dimmed: {
    opacity: QUEUED_ROW_OPACITY,
  },
  actions: {
    flexDirection: 'row',
    gap: space(1),
    justifyContent: 'flex-end',
  },
})
