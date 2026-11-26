import type { ReactNode } from 'react'
import { EFontWeight, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { MessageSquareShare } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import { CollapsibleBody } from './collapsible-body'

export const InboundBubble = ({ caption, children }: { caption: string; children: ReactNode }) => {
  const theme = useTheme()
  return (
    <View style={[styles.bubble, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={styles.caption}>
        <Icon icon={MessageSquareShare} color={theme.mutedForeground} size={14} />
        <Text
          size={ETextRole.Xs}
          weight={EFontWeight.Medium}
          tone={ETextTone.Muted}
          style={styles.captionText}
        >
          {caption}
        </Text>
      </View>
      <CollapsibleBody>{children}</CollapsibleBody>
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'flex-start',
    borderRadius: radius(1.4),
    borderWidth: 1,
    gap: space(1.5),
    maxWidth: '100%',
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  caption: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1.5),
  },
  captionText: {
    flexShrink: 1,
  },
})
