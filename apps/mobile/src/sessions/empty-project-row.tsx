import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

export const EmptyProjectRow = ({ onStartSession }: { onStartSession: () => void }) => (
  <View style={styles.row}>
    <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
      No sessions yet
    </Text>
    <Button
      label="Start a session"
      onPress={onStartSession}
      size={EButtonSize.Sm}
      variant={EButtonVariant.Outline}
    />
  </View>
)

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    justifyContent: 'space-between',
    paddingHorizontal: space(2),
    paddingVertical: space(1),
  },
})
