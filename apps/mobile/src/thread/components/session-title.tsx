import { EFontWeight, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import { StatusIcon } from '../../sessions/status-icon'
import type { SessionHeader } from '../v2/session-header'

export const SessionTitle = ({ header }: { header: SessionHeader }) => (
  <View style={styles.root} accessibilityRole="header">
    <Text size={ETextRole.Sm} weight={EFontWeight.Medium} numberOfLines={1}>
      {header.title}
    </Text>
    {header.subtitle === null ? null : (
      <View style={styles.state}>
        <StatusIcon status={header.display} unread={false} />
        <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1}>
          {header.subtitle}
        </Text>
      </View>
    )}
  </View>
)

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
    gap: space(0.5),
    paddingHorizontal: space(1),
  },
  state: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1.5),
  },
})
