import { ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import { usePosture } from '../layout/use-posture'
import { TAB_ICONS } from './tab-icons'
import type { EAppTab } from './tabs'

export const InProgressScreen = ({ tab }: { tab: EAppTab }) => {
  const theme = useTheme()
  const posture = usePosture()
  return (
    <View style={[styles.root, { paddingBottom: posture.clearance.bottom }]}>
      <Icon icon={TAB_ICONS[tab]} color={theme.mutedForeground} size={32} />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        In progress
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    flex: 1,
    gap: space(3),
    justifyContent: 'center',
  },
})
