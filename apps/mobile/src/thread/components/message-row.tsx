import {
  Bubble,
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Icon,
  Markdown,
  MessageAction,
  MessageActions,
  MessageFooter,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { messageTimeOf } from '@dltech/atlas-client/transcript'
import { space } from '@dltech/atlas-ui/tokens'
import { Pencil, Terminal, Trash2 } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import {
  EMessageAuthor,
  senderLabelOf,
  type CommandRow,
  type MessageRow,
  type SessionNameOf,
} from '../rows'
import { MessageAttachments } from './message-attachments'

export type QueuedMessageActions = {
  label: string
  disabled: boolean
  onEdit?: (() => void) | undefined
  onRemove?: (() => void) | undefined
}

const SentAt = ({ at, align }: { at: string | undefined; align?: 'start' | 'end' }) => {
  const clock = messageTimeOf({ at, now: Date.now() })
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

const QueuedFooter = ({ actions }: { actions: QueuedMessageActions }) => (
  <MessageFooter align="end">
    <Text
      size={ETextRole.Xs}
      weight={EFontWeight.Medium}
      tone={ETextTone.Muted}
      style={styles.timestamp}
    >
      {actions.label}
    </Text>
    {actions.disabled ? null : (
      <MessageActions>
        <MessageAction icon={Pencil} label="Edit" onPress={actions.onEdit} />
        <MessageAction icon={Trash2} label="Remove" onPress={actions.onRemove} />
      </MessageActions>
    )}
  </MessageFooter>
)

const splitOf = (text: string): { name: string; argument: string } => {
  const at = text.indexOf(' ')
  return at === -1
    ? { name: text, argument: '' }
    : { name: text.slice(0, at), argument: text.slice(at) }
}

const CommandMessage = ({ command, at }: { command: CommandRow; at: string | undefined }) => {
  const theme = useTheme()
  const { name, argument } = splitOf(command.text)
  return (
    <View style={styles.you}>
      <View style={styles.command}>
        <Icon icon={Terminal} color={theme.mutedForeground} size={14} />
        <Text size={ETextRole.Sm} style={styles.commandText}>
          <Text
            size={ETextRole.Sm}
            family={EFontFamily.Mono}
            weight={EFontWeight.Medium}
            tone={ETextTone.Primary}
          >
            {name}
          </Text>
          {argument}
        </Text>
      </View>
      <SentAt at={at} align="end" />
    </View>
  )
}

export const MessageRowView = ({
  row,
  threadId,
  sessionId,
  sessionNameOf,
  queued,
}: {
  row: MessageRow
  threadId: string | undefined
  sessionId: string | undefined
  sessionNameOf?: SessionNameOf | undefined
  queued?: QueuedMessageActions | undefined
}) => {
  if (row.author === EMessageAuthor.Atlas) {
    const caption = senderLabelOf({
      row,
      ...(sessionNameOf === undefined ? {} : { sessionNameOf }),
    })
    return (
      <View style={styles.message}>
        {caption === undefined ? null : (
          <Text size={ETextRole.Xs} weight={EFontWeight.Medium} tone={ETextTone.Muted}>
            {caption}
          </Text>
        )}
        <Markdown value={row.text} selectable />
        <SentAt at={row.at} />
      </View>
    )
  }

  if (row.command !== undefined) return <CommandMessage command={row.command} at={row.at} />

  if (row.staged === true) {
    return (
      <View style={[styles.you, styles.staged]}>
        <MessageAttachments
          threadId={threadId}
          sessionId={sessionId}
          attachments={row.attachments}
        />
        {row.text.trim().length > 0 ? (
          <Bubble>
            <Markdown value={row.text} breaks selectable />
          </Bubble>
        ) : null}
      </View>
    )
  }

  return (
    <View style={styles.you}>
      <MessageAttachments threadId={threadId} sessionId={sessionId} attachments={row.attachments} />
      {row.text.trim().length > 0 ? (
        <Bubble>
          <Markdown value={row.text} breaks selectable />
        </Bubble>
      ) : null}
      {queued === undefined ? (
        <SentAt at={row.at} align="end" />
      ) : (
        <QueuedFooter actions={queued} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  staged: {
    opacity: 0.45,
  },
  message: {
    gap: space(2),
  },
  you: {
    alignItems: 'flex-end',
    gap: space(2),
  },
  command: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space(1.5),
  },
  commandText: {
    flexShrink: 1,
  },
  timestamp: {
    fontVariant: ['tabular-nums'],
  },
})
