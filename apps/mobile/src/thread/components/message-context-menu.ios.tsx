import { useIsDark } from '@dltech/atlas-ui-native'
import { Button, ContextMenu, Host, RNHostView } from '@expo/ui/swift-ui'
import { StyleSheet, View } from 'react-native'

import { EMessageAction, messageActionLabelOf } from '../message-actions'
import type { MessageContextMenuProps } from './message-context-menu-props'

const SYMBOL: Record<
  EMessageAction,
  'doc.on.doc' | 'clock.arrow.circlepath' | 'rectangle.compress.vertical'
> = {
  [EMessageAction.Copy]: 'doc.on.doc',
  [EMessageAction.Rewind]: 'clock.arrow.circlepath',
  [EMessageAction.Summarise]: 'rectangle.compress.vertical',
}

export const MessageContextMenu = ({
  actions,
  onAction,
  align = 'start',
  children,
}: MessageContextMenuProps) => {
  const dark = useIsDark()
  if (actions.length === 0) return children
  return (
    <Host
      matchContents={{ vertical: true }}
      ignoreSafeArea="all"
      colorScheme={dark ? 'dark' : 'light'}
      style={styles.row}
    >
      <ContextMenu>
        <ContextMenu.Items>
          {actions.map((action) => (
            <Button
              key={action}
              label={messageActionLabelOf(action)}
              systemImage={SYMBOL[action]}
              onPress={() => onAction(action)}
            />
          ))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents={{ vertical: true }}>
            <View style={align === 'end' ? styles.end : styles.start}>{children}</View>
          </RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  )
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'stretch',
  },
  start: {
    alignItems: 'stretch',
  },
  end: {
    alignItems: 'flex-end',
  },
})
