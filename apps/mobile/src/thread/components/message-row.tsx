import {
  Bubble,
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Icon,
  type IRenderDiagramArgs,
  Markdown,
  MessageFooter,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { messageTimeOf } from '@dltech/atlas-client/transcript'
import { space } from '@dltech/atlas-ui/tokens'
import { Terminal } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import { DiagramCard } from '../diagrams/diagram-card'
import { hasMermaidFence } from '../diagrams/diagram-layout'
import {
  EMessageAuthor,
  senderLabelOf,
  type CommandRow,
  type MessageRow,
  type SessionNameOf,
} from '../rows'
import { CollapsibleBody } from './collapsible-body'
import { MessageAttachments } from './message-attachments'

const renderDiagram = ({ source, closed }: IRenderDiagramArgs) => (
  <DiagramCard source={source} closed={closed} />
)

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
  queuedLabel,
}: {
  row: MessageRow
  threadId: string | undefined
  sessionId: string | undefined
  sessionNameOf?: SessionNameOf | undefined
  queuedLabel?: string | undefined
}) => {
  if (row.author === EMessageAuthor.Atlas) {
    const caption = senderLabelOf({ row, sessionNameOf })
    return (
      <View style={styles.message}>
        {caption === undefined ? null : (
          <Text size={ETextRole.Xs} weight={EFontWeight.Medium} tone={ETextTone.Muted}>
            {caption}
          </Text>
        )}
        {caption === undefined ? (
          <Markdown value={row.text} selectable renderDiagram={renderDiagram} />
        ) : (
          <CollapsibleBody>
            <Markdown value={row.text} selectable renderDiagram={renderDiagram} />
          </CollapsibleBody>
        )}
        <SentAt at={row.at} />
      </View>
    )
  }

  if (row.command !== undefined) return <CommandMessage command={row.command} at={row.at} />

  const bubbleStyle = hasMermaidFence(row.text) ? styles.diagramBubble : undefined

  if (row.staged === true) {
    return (
      <View style={[styles.you, styles.staged]}>
        <MessageAttachments
          threadId={threadId}
          sessionId={sessionId}
          attachments={row.attachments}
        />
        {row.text.trim().length > 0 ? (
          <Bubble style={bubbleStyle}>
            <Markdown value={row.text} breaks selectable renderDiagram={renderDiagram} />
          </Bubble>
        ) : null}
      </View>
    )
  }

  return (
    <View style={styles.you}>
      <MessageAttachments threadId={threadId} sessionId={sessionId} attachments={row.attachments} />
      {row.text.trim().length > 0 ? (
        <Bubble style={bubbleStyle}>
          <Markdown value={row.text} breaks selectable renderDiagram={renderDiagram} />
        </Bubble>
      ) : null}
      {queuedLabel === undefined ? (
        <SentAt at={row.at} align="end" />
      ) : (
        <MessageFooter align="end">
          <Text
            size={ETextRole.Xs}
            weight={EFontWeight.Medium}
            tone={ETextTone.Muted}
            style={styles.timestamp}
          >
            {queuedLabel}
          </Text>
        </MessageFooter>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  staged: {
    opacity: 0.45,
  },
  diagramBubble: {
    alignSelf: 'stretch',
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
