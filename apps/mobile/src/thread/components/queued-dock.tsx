import { ETextRole, ETextTone, Icon, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Bell, Clock, Paperclip } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import type { QueuedDockState } from '../v2/queued-dock'

const attachmentLineOf = (count: number): string =>
  count === 1 ? '1 attachment' : `${count} attachments`

export const QueuedDock = ({ dock }: { dock: QueuedDockState }) => {
  const theme = useTheme()
  if (dock.messages.length === 0 && dock.notices.length === 0) return null
  return (
    <View style={styles.root} accessibilityLabel="Queued">
      {dock.notices.map((notice) => (
        <View key={notice.id} style={styles.notice}>
          <Icon
            icon={Bell}
            size={12}
            color={notice.failed ? theme.destructive : theme.mutedForeground}
          />
          <Text
            size={ETextRole.Xs}
            tone={notice.failed ? ETextTone.Destructive : ETextTone.Muted}
            numberOfLines={1}
            style={styles.grow}
          >
            {notice.text}
          </Text>
        </View>
      ))}
      {dock.messages.map((message) => (
        <View
          key={message.id}
          style={[
            styles.message,
            {
              backgroundColor: theme.card,
              borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
            },
            dock.stagedIds.has(message.id) ? styles.staged : null,
          ]}
        >
          <Icon icon={Clock} size={14} color={theme.mutedForeground} />
          <View style={styles.grow}>
            {message.text.trim().length === 0 ? null : (
              <Text size={ETextRole.Sm} numberOfLines={2}>
                {message.text}
              </Text>
            )}
            {message.attachments.length === 0 ? null : (
              <View style={styles.notice}>
                <Icon icon={Paperclip} size={12} color={theme.mutedForeground} />
                <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
                  {attachmentLineOf(message.attachments.length)}
                </Text>
              </View>
            )}
          </View>
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            Queued
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    gap: space(1.5),
    paddingBottom: space(2),
    paddingHorizontal: space(3),
  },
  notice: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1.5),
    paddingHorizontal: space(1),
  },
  message: {
    alignItems: 'center',
    borderRadius: radius(1.4),
    borderWidth: 1,
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  staged: {
    opacity: 0.6,
  },
  grow: {
    flex: 1,
    gap: space(1),
  },
})
