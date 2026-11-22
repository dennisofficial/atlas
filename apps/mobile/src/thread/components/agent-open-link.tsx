import { space } from '@dltech/atlas-ui/tokens'
import { ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { ChevronRight } from 'lucide-react-native'
import { Pressable, StyleSheet } from 'react-native'

export const AgentOpenLink = ({ onPress }: { onPress: () => void }) => {
  const theme = useTheme()
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
        Open sub-agent transcript
      </Text>
      <Icon icon={ChevronRight} color={theme.mutedForeground} size={14} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  link: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1),
    paddingVertical: space(1),
  },
})
