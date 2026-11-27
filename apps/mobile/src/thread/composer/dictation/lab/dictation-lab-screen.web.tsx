import { space } from '@dltech/atlas-ui/tokens'
import { ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { StyleSheet, View } from 'react-native'

export const DictationLabScreen = () => (
  <View style={styles.screen}>
    <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
      The dictation lab uses SwiftUI controls and runs on iOS only.
    </Text>
  </View>
)

const styles = StyleSheet.create({
  screen: {
    padding: space(4),
  },
})
