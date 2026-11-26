import { Button, EButtonSize, EButtonVariant } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import type { SessionNameOf } from '../rows'
import {
  queuedLabelOf,
  QUEUED_ROW_OPACITY,
  type QueuedTranscript,
} from '../session/queued-transcript'
import { ThreadRowView } from './thread-row'

export type QueuedTurnsProps = {
  queued: QueuedTranscript
  onEdit?: ((inboxId: number) => void) | undefined
  onRemove?: ((inboxId: number) => void) | undefined
}

export const QueuedTurns = ({
  queued,
  threadId,
  sessionId,
  sessionNameOf,
  onEdit,
  onRemove,
}: QueuedTurnsProps & {
  threadId: string | undefined
  sessionId: string | undefined
  sessionNameOf?: SessionNameOf | undefined
}) => {
  if (queued.rows.length === 0) return null
  const label = queuedLabelOf(queued)
  return (
    <View accessibilityLabel="Queued">
      {queued.rows.map(({ id, row, withdrawInboxId }) => (
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
  row: {
    gap: space(1),
    paddingVertical: space(1.5),
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
