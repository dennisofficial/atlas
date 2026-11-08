import { space } from '@dltech/atlas-ui/tokens'
import { Card, ETextRole, ETextTone, Markdown, Text } from '@dltech/atlas-ui-native'
import { StyleSheet, View } from 'react-native'

import { EMessageAuthor, type MessageRow } from '../rows'
import { MessageAttachments } from './message-attachments'

const STEER_CAPTION = 'Steered mid-turn'

export const MessageRowView = ({
  row,
  threadId,
}: {
  row: MessageRow
  threadId: string | undefined
}) => {
  if (row.author === EMessageAuthor.Atlas) {
    return (
      <View>
        <Markdown value={row.text} />
      </View>
    )
  }

  return (
    <View style={styles.you}>
      <Card style={styles.bubble}>
        {row.text.length > 0 ? <Markdown value={row.text} breaks /> : null}
        <MessageAttachments threadId={threadId} attachments={row.attachments} />
      </Card>
      {row.steer ? (
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {STEER_CAPTION}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: {
    gap: space(2),
    maxWidth: '85%',
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
  },
  you: {
    alignItems: 'flex-end',
    gap: space(1.5),
  },
})
