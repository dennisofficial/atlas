import { messageTimeOf } from '@dltech/atlas-client/transcript'
import { EFontWeight, ETextRole, ETextTone, MessageFooter, Text } from '@dltech/atlas-ui-native'
import { StyleSheet } from 'react-native'

import type { EMessageAction } from '../message-actions'
import { MessageActionsBar } from './message-actions-bar'

export const MessageRowFooter = ({
  at,
  align,
  queuedLabel,
  actions,
  copied,
  onAction,
}: {
  at: string | undefined
  align: 'start' | 'end'
  queuedLabel?: string | undefined
  actions: readonly EMessageAction[]
  copied: boolean
  onAction: (action: EMessageAction) => void
}) => {
  const clock = queuedLabel ?? messageTimeOf({ at, now: Date.now() })
  if (clock === undefined && actions.length === 0) return null
  return (
    <MessageFooter align={align}>
      {clock === undefined ? null : (
        <Text
          size={ETextRole.Xs}
          weight={EFontWeight.Medium}
          tone={ETextTone.Muted}
          style={styles.timestamp}
        >
          {clock}
        </Text>
      )}
      {actions.length === 0 ? null : (
        <MessageActionsBar actions={actions} copied={copied} onAction={onAction} />
      )}
    </MessageFooter>
  )
}

const styles = StyleSheet.create({
  timestamp: {
    fontVariant: ['tabular-nums'],
  },
})
