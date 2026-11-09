import {
  Bubble,
  EFontWeight,
  ETextRole,
  ETextTone,
  Markdown,
  MessageFooter,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import { clockTimeOf } from '../../lib/clock-time'
import { EMessageAuthor, type MessageRow } from '../rows'
import { MessageAttachments } from './message-attachments'

const SentAt = ({ at, align }: { at: string | undefined; align?: 'start' | 'end' }) => {
  const clock = clockTimeOf(at)
  if (clock === undefined) return null
  return (
    <MessageFooter align={align ?? 'start'}>
      <Text
        size={ETextRole.Xs}
        weight={EFontWeight.Medium}
        tone={ETextTone.Muted}
        style={styles.timestamp}
      >
        {clock}
      </Text>
    </MessageFooter>
  )
}

export const MessageRowView = ({
  row,
  threadId,
}: {
  row: MessageRow
  threadId: string | undefined
}) => {
  if (row.author === EMessageAuthor.Atlas) {
    return (
      <View style={styles.message}>
        <Markdown value={row.text} selectable />
        <SentAt at={row.at} />
      </View>
    )
  }

  return (
    <View style={styles.you}>
      <MessageAttachments threadId={threadId} attachments={row.attachments} />
      {row.text.trim().length > 0 ? (
        <Bubble>
          <Markdown value={row.text} breaks selectable />
        </Bubble>
      ) : null}
      <SentAt at={row.at} align="end" />
    </View>
  )
}

const styles = StyleSheet.create({
  message: {
    gap: space(2),
  },
  you: {
    alignItems: 'flex-end',
    gap: space(2),
  },
  timestamp: {
    fontVariant: ['tabular-nums'],
  },
})
