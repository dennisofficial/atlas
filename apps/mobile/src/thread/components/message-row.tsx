import {
  Bubble,
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Icon,
  type IRenderDiagramArgs,
  Markdown,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { Terminal } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import { DiagramCard } from '../diagrams/diagram-card'
import { hasCodeFence } from '../diagrams/diagram-layout'
import type { EMessageAction, MessageActionHandlers } from '../message-actions'
import {
  EMessageAuthor,
  senderLabelOf,
  type CommandRow,
  type MessageRow,
  type SessionNameOf,
} from '../rows'
import { InboundBubble } from './inbound-bubble'
import { MessageAttachments } from './message-attachments'
import { MessageRowFooter } from './message-footer'
import { useMessageActions } from './use-message-actions'

const NO_ACTIONS: readonly EMessageAction[] = []

const ignoreAction = () => undefined

const renderDiagram = ({ source, closed }: IRenderDiagramArgs) => (
  <DiagramCard source={source} closed={closed} />
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
      <MessageRowFooter
        at={at}
        align="end"
        actions={NO_ACTIONS}
        copied={false}
        onAction={ignoreAction}
      />
    </View>
  )
}

export const MessageRowView = ({
  row,
  threadId,
  sessionId,
  sessionNameOf,
  queuedLabel,
  messageActions,
}: {
  row: MessageRow
  threadId: string | undefined
  sessionId: string | undefined
  sessionNameOf?: SessionNameOf | undefined
  queuedLabel?: string | undefined
  messageActions?: MessageActionHandlers | undefined
}) => {
  const { actions, copied, handleAction } = useMessageActions({
    row,
    queued: queuedLabel !== undefined,
    handlers: messageActions,
  })

  if (row.author === EMessageAuthor.Atlas) {
    const caption = senderLabelOf({ row, sessionNameOf })
    return (
      <View style={styles.message}>
        {caption === undefined ? (
          <Markdown value={row.text} selectable renderDiagram={renderDiagram} />
        ) : (
          <InboundBubble caption={caption}>
            <Markdown value={row.text} selectable renderDiagram={renderDiagram} />
          </InboundBubble>
        )}
        <MessageRowFooter
          at={row.at}
          align="start"
          actions={actions}
          copied={copied}
          onAction={handleAction}
        />
      </View>
    )
  }

  if (row.command !== undefined) return <CommandMessage command={row.command} at={row.at} />

  const bubbleStyle = hasCodeFence(row.text) ? styles.wideBubble : undefined

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
      <MessageRowFooter
        at={row.at}
        align="end"
        queuedLabel={queuedLabel}
        actions={actions}
        copied={copied}
        onAction={handleAction}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  staged: {
    opacity: 0.45,
  },
  wideBubble: {
    width: '80%',
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
})
