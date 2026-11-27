import { ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import {
  AppWindow,
  CalendarClock,
  FolderKanban,
  type LucideIcon,
  MessagesSquare,
  UserRound,
} from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import { EAppTab } from './tabs'

const TAB_ICONS: Record<EAppTab, LucideIcon> = {
  [EAppTab.Sessions]: MessagesSquare,
  [EAppTab.Routines]: CalendarClock,
  [EAppTab.Projects]: FolderKanban,
  [EAppTab.Artifacts]: AppWindow,
  [EAppTab.Settings]: UserRound,
}

export const InProgressScreen = ({ tab }: { tab: EAppTab }) => {
  const theme = useTheme()
  return (
    <View style={styles.root}>
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
